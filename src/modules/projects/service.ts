import { z } from "zod";
import { requirePerm, requireWritable, can, type Ctx } from "@/server/context";
import { audit, diff } from "@/server/audit";
import { nextNumber } from "@/server/sequences";
import { notFound, rule, validation, conflict } from "@/lib/errors";
import { zDate, zDecimal, zOptDate, zOptId, zOptStr, zStr, zBool } from "@/lib/zod-helpers";
import { addMonths, civil, monthStart, monthsBetween, toCivil, todayIn, type CivilDate } from "@/lib/dates";
import { allocate, dec, money, qty, sum } from "@/lib/money";
import { PROJECT_TEMPLATES } from "../admin/defaults";
import { validateCustomFields } from "../config/custom-fields";
import type { TenantTx } from "@/server/tenant-db";

export const projectSchema = z.object({
  companyId: z.string().min(1), name: zStr(3), partyId: z.string().min(1), contractId: zOptId, projectTypeId: zOptId, managerUserId: zOptId,
  sponsorContactId: zOptId, businessUnitId: zOptId, costCenterId: zOptId, plannedStart: zDate, plannedEnd: zDate,
  progressMethod: z.enum(["HOURS", "MILESTONES", "TASK_WEIGHT", "MANUAL"]).default("HOURS"), description: zOptStr,
  // linha de base inicial (opcional — preenchida a partir da proposta quando houver contrato)
  effortHours: zDecimal, revenue: zDecimal, laborCost: zDecimal, thirdPartyCost: zDecimal, expenseCost: zDecimal, applyTemplate: zBool,
}).passthrough();
export type ProjectInput = z.infer<typeof projectSchema>;

/** Valores de baseline sugeridos a partir do contrato/proposta aceita. */
export async function baselineSuggestion(ctx: Ctx, contractId: string) {
  const c = await ctx.db.contract.findFirst({ where: { id: contractId } });
  if (!c) return null;
  const v = c.proposalVersionId ? await ctx.db.proposalVersion.findFirst({ where: { id: c.proposalVersionId } }) : null;
  return {
    effortHours: v?.totalHours.toString() ?? c.hoursLimit?.toString() ?? "0", revenue: c.totalValue.toString(),
    laborCost: v?.laborCost.toString() ?? "0", thirdPartyCost: v?.thirdPartyCost.toString() ?? "0", expenseCost: v?.expenseCost.toString() ?? "0",
    plannedStart: toCivil(c.startDate), plannedEnd: c.endDate ? toCivil(c.endDate) : toCivil(c.startDate),
  };
}

async function writeBaseline(ctx: Ctx, tx: TenantTx, projectId: string, version: number, label: string, b: { plannedStart: CivilDate; plannedEnd: CivilDate; effortHours: string; revenue: string; laborCost: string; thirdPartyCost: string; expenseCost: string; scope?: string; reason?: string }) {
  const bl = await tx.projectBaseline.create({
    data: { organizationId: ctx.orgId, projectId, version, label, scope: b.scope ?? null, plannedStart: civil(b.plannedStart), plannedEnd: civil(b.plannedEnd), effortHours: qty(b.effortHours), revenue: money(b.revenue), laborCost: money(b.laborCost), thirdPartyCost: money(b.thirdPartyCost), expenseCost: money(b.expenseCost), reason: b.reason ?? null, approvedById: ctx.userId },
  });
  // Distribuição mensal uniforme (editável depois); soma exata por rateio de centavos
  const months = monthsBetween(b.plannedStart, b.plannedEnd);
  const w = months.map(() => 1);
  const split = (v: string) => allocate(v, w);
  const [rev, lab, tp, ex] = [split(b.revenue), split(b.laborCost), split(b.thirdPartyCost), split(b.expenseCost)];
  const hrs = allocate(b.effortHours, w);
  await tx.baselineMonth.createMany({ data: months.map((m, i) => ({ organizationId: ctx.orgId, baselineId: bl.id, month: civil(m), revenue: rev[i], laborCost: lab[i], thirdPartyCost: tp[i], expenseCost: ex[i], hours: hrs[i] })) });
  return bl;
}

export async function createProject(ctx: Ctx, i: ProjectInput) {
  requirePerm(ctx, "project.write");
  requireWritable(ctx);
  if (i.plannedEnd < i.plannedStart) throw validation("Término planejado anterior ao início.");
  const party = await ctx.db.party.findFirst({ where: { id: i.partyId } });
  if (!party) throw validation("Cliente inválido.");
  let contract = null;
  if (i.contractId) {
    contract = await ctx.db.contract.findFirst({ where: { id: i.contractId } });
    if (!contract) throw validation("Contrato inválido.");
    if (contract.partyId !== i.partyId) throw validation("Contrato de outro cliente.");
    if (contract.status !== "ACTIVE" && contract.status !== "DRAFT") throw rule("Contrato não está ativo.");
  }
  const type = i.projectTypeId ? await ctx.db.projectType.findFirst({ where: { id: i.projectTypeId } }) : null;
  const customFields = await validateCustomFields(ctx, "PROJECT", i as Record<string, unknown>);
  const p = await ctx.db.$transaction(async (tx) => {
    const code = await nextNumber(tx, ctx.orgId, "PROJECT");
    const proj = await tx.project.create({
      data: {
        organizationId: ctx.orgId, companyId: i.companyId, code, name: i.name, partyId: i.partyId, contractId: i.contractId ?? null, projectTypeId: i.projectTypeId ?? null,
        managerUserId: i.managerUserId ?? ctx.userId, sponsorContactId: i.sponsorContactId ?? null, businessUnitId: i.businessUnitId ?? contract?.businessUnitId ?? null, costCenterId: i.costCenterId ?? contract?.costCenterId ?? null,
        plannedStart: civil(i.plannedStart), plannedEnd: civil(i.plannedEnd), progressMethod: i.progressMethod, description: i.description ?? null, customFields, status: "PLANNING",
      },
    });
    await writeBaseline(ctx, tx, proj.id, 1, "Orçamento original", { plannedStart: i.plannedStart, plannedEnd: i.plannedEnd, effortHours: i.effortHours, revenue: i.revenue, laborCost: i.laborCost, thirdPartyCost: i.thirdPartyCost, expenseCost: i.expenseCost, scope: i.description });
    if (i.applyTemplate && type?.templateKey && PROJECT_TEMPLATES[type.templateKey]) await applyTemplate(ctx, tx, proj.id, type.templateKey, i.plannedStart, i.plannedEnd, i.effortHours);
    await audit(ctx, { action: "project.create", entity: "Project", entityId: proj.id, companyId: i.companyId, changes: { code, contract: contract?.number, template: type?.templateKey } }, tx);
    return proj;
  });
  return p;
}

/** Gera WBS a partir do modelo: fases distribuídas no prazo e horas pela participação de cada item. */
async function applyTemplate(ctx: Ctx, tx: TenantTx, projectId: string, key: string, start: CivilDate, end: CivilDate, effort: string) {
  const tpl = PROJECT_TEMPLATES[key];
  const days = Math.max(1, Math.round((civil(end).getTime() - civil(start).getTime()) / 86400000));
  const totalShare = tpl.reduce((a, ph) => a + ph.items.reduce((b, it) => b + it.share, 0), 0);
  let cursor = 0;
  for (let p = 0; p < tpl.length; p++) {
    const ph = tpl[p];
    const phShare = ph.items.reduce((b, it) => b + it.share, 0);
    const phDays = Math.max(1, Math.round((days * phShare) / totalShare));
    const phStart = new Date(civil(start).getTime() + cursor * 86400000);
    const phEnd = new Date(Math.min(civil(end).getTime(), phStart.getTime() + phDays * 86400000));
    cursor += phDays;
    const phase = await tx.projectTask.create({ data: { organizationId: ctx.orgId, projectId, wbsCode: `${p + 1}`, name: ph.phase, kind: "PHASE", plannedStart: phStart, plannedEnd: phEnd, sortOrder: p * 100 } });
    for (let j = 0; j < ph.items.length; j++) {
      const it = ph.items[j];
      await tx.projectTask.create({
        data: { organizationId: ctx.orgId, projectId, parentId: phase.id, wbsCode: `${p + 1}.${j + 1}`, name: it.name, kind: it.kind, plannedStart: it.kind === "MILESTONE" ? phEnd : phStart, plannedEnd: phEnd, plannedHours: qty(dec(effort).times(it.share).div(totalShare)), weight: dec(it.share), requiresAcceptance: !!it.acceptance, acceptanceStatus: it.acceptance ? "PENDING" : null, sortOrder: p * 100 + j + 1 },
      });
    }
  }
}

export async function updateProject(ctx: Ctx, id: string, i: Partial<ProjectInput> & { status?: string; manualProgressPct?: string }) {
  requirePerm(ctx, "project.write");
  requireWritable(ctx);
  const before = await ctx.db.project.findFirst({ where: { id } });
  if (!before) throw notFound("Projeto");
  if (before.status === "COMPLETED" && before.financialStatus === "CLOSED") throw rule("Projeto encerrado.");
  const data: Record<string, unknown> = {};
  for (const k of ["name", "managerUserId", "sponsorContactId", "businessUnitId", "costCenterId", "description", "progressMethod"] as const) if (i[k] !== undefined) data[k] = i[k] ?? null;
  if (i.status) {
    const allowed: Record<string, string[]> = { PLANNING: ["ACTIVE", "CANCELED"], ACTIVE: ["ON_HOLD", "CANCELED"], ON_HOLD: ["ACTIVE", "CANCELED"] };
    if (i.status !== before.status && !(allowed[before.status] ?? []).includes(i.status)) throw rule(`Transição de ${before.status} para ${i.status} não permitida (use o encerramento operacional).`);
    data.status = i.status;
    if (i.status === "ACTIVE" && !before.actualStart) data.actualStart = civil(todayIn(ctx.timezone));
  }
  if (i.manualProgressPct !== undefined && i.manualProgressPct !== "") {
    const m = dec(i.manualProgressPct);
    if (m.lt(0) || m.gt(100)) throw validation("Avanço manual entre 0 e 100.");
    data.manualProgressPct = m;
  }
  const after = await ctx.db.project.update({ where: { id }, data });
  await audit(ctx, { action: "project.update", entity: "Project", entityId: id, companyId: after.companyId, changes: diff(before, after) });
  return after;
}

// ------------------------------------------------------------------ Linha de base versionada
export const baselineSchema = z.object({ projectId: z.string(), label: zStr(3), reason: zStr(3, "Informe o motivo da revisão"), plannedStart: zDate, plannedEnd: zDate, effortHours: zDecimal, revenue: zDecimal, laborCost: zDecimal, thirdPartyCost: zDecimal, expenseCost: zDecimal, scope: zOptStr });
export async function reviseBaseline(ctx: Ctx, i: z.infer<typeof baselineSchema>) {
  requirePerm(ctx, "project.baseline");
  requireWritable(ctx);
  if (i.plannedEnd < i.plannedStart) throw validation("Período inválido.");
  return ctx.db.$transaction(async (tx) => {
    const last = await tx.projectBaseline.findFirst({ where: { projectId: i.projectId }, orderBy: { version: "desc" } });
    if (!last) throw notFound("Linha de base");
    const bl = await writeBaseline(ctx, tx, i.projectId, last.version + 1, i.label, i);
    await tx.project.update({ where: { id: i.projectId }, data: { plannedStart: civil(i.plannedStart), plannedEnd: civil(i.plannedEnd) } });
    await audit(ctx, { action: "project.baseline", entity: "Project", entityId: i.projectId, reason: i.reason, changes: { version: bl.version, revenue: i.revenue, laborCost: i.laborCost, effort: i.effortHours } }, tx);
    return bl;
  });
}

// ------------------------------------------------------------------ WBS, dependências, kanban, aceite
export const taskSchema = z.object({
  projectId: z.string(), parentId: zOptId, name: zStr(2), kind: z.enum(["PHASE", "DELIVERABLE", "TASK", "MILESTONE"]).default("TASK"),
  plannedStart: zOptDate, plannedEnd: zOptDate, plannedHours: zDecimal, weight: zDecimal, assigneeProfessionalId: zOptId, requiresAcceptance: zBool,
});
export async function saveTask(ctx: Ctx, id: string | null, i: z.infer<typeof taskSchema>) {
  requirePerm(ctx, "project.write");
  requireWritable(ctx);
  if (i.plannedStart && i.plannedEnd && i.plannedEnd < i.plannedStart) throw validation("Término anterior ao início.");
  const siblings = await ctx.db.projectTask.findMany({ where: { projectId: i.projectId, parentId: i.parentId ?? null } });
  const parent = i.parentId ? await ctx.db.projectTask.findFirst({ where: { id: i.parentId, projectId: i.projectId } }) : null;
  if (i.parentId && !parent) throw validation("Item pai inválido.");
  const data = {
    projectId: i.projectId, parentId: i.parentId ?? null, name: i.name, kind: i.kind, plannedStart: i.plannedStart ? civil(i.plannedStart) : null, plannedEnd: i.plannedEnd ? civil(i.plannedEnd) : null,
    plannedHours: qty(i.plannedHours), weight: dec(i.weight).isZero() ? dec(1) : dec(i.weight), assigneeProfessionalId: i.assigneeProfessionalId ?? null, requiresAcceptance: i.requiresAcceptance,
  };
  if (id) {
    const t = await ctx.db.projectTask.update({ where: { id }, data: { ...data, acceptanceStatus: i.requiresAcceptance ? undefined : null } });
    await audit(ctx, { action: "task.update", entity: "Project", entityId: i.projectId, changes: { task: t.wbsCode, name: t.name } });
    return t;
  }
  const wbsCode = parent ? `${parent.wbsCode}.${siblings.length + 1}` : `${siblings.length + 1}`;
  const t = await ctx.db.projectTask.create({ data: { organizationId: ctx.orgId, ...data, wbsCode, acceptanceStatus: i.requiresAcceptance ? "PENDING" : null, sortOrder: (parent?.sortOrder ?? 0) + siblings.length + 1 } });
  await audit(ctx, { action: "task.create", entity: "Project", entityId: i.projectId, changes: { task: wbsCode, name: i.name } });
  return t;
}

export async function setTaskStatus(ctx: Ctx, id: string, status: "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE") {
  if (!can(ctx, "project.write") && !can(ctx, "time.write")) requirePerm(ctx, "project.write");
  requireWritable(ctx);
  const t = await ctx.db.projectTask.findFirst({ where: { id } });
  if (!t) throw notFound("Atividade");
  if (!can(ctx, "project.write") && t.assigneeProfessionalId !== ctx.professionalId) throw rule("Você só pode mover atividades atribuídas a você.");
  if (status === "IN_PROGRESS" || status === "DONE") {
    const preds = await ctx.db.taskDependency.findMany({ where: { successorId: id } });
    const notDone = preds.length ? await ctx.db.projectTask.count({ where: { id: { in: preds.map((p) => p.predecessorId) }, status: { not: "DONE" } } }) : 0;
    if (notDone > 0) throw rule("Dependência (término-início) pendente: conclua as predecessoras antes.");
  }
  const today = civil(todayIn(ctx.timezone));
  await ctx.db.projectTask.update({ where: { id }, data: { status, actualStart: status !== "TODO" ? t.actualStart ?? today : t.actualStart, actualEnd: status === "DONE" ? today : null } });
  await audit(ctx, { action: "task.status", entity: "Project", entityId: t.projectId, changes: { task: t.wbsCode, from: t.status, to: status } });
}

export async function addDependency(ctx: Ctx, predecessorId: string, successorId: string) {
  requirePerm(ctx, "project.write");
  if (predecessorId === successorId) throw validation("Uma atividade não depende de si mesma.");
  const [a, b] = await Promise.all([ctx.db.projectTask.findFirst({ where: { id: predecessorId } }), ctx.db.projectTask.findFirst({ where: { id: successorId } })]);
  if (!a || !b || a.projectId !== b.projectId) throw validation("Atividades inválidas.");
  // Evita ciclo: o sucessor não pode (direta ou indiretamente) preceder o predecessor
  const deps = await ctx.db.taskDependency.findMany({ where: { predecessorId: { in: (await ctx.db.projectTask.findMany({ where: { projectId: a.projectId } })).map((t) => t.id) } } });
  const next = new Map<string, string[]>();
  for (const d of deps) next.set(d.predecessorId, [...(next.get(d.predecessorId) ?? []), d.successorId]);
  const stack = [successorId];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === predecessorId) throw rule("Dependência criaria um ciclo.");
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(next.get(cur) ?? []));
  }
  if (await ctx.db.taskDependency.findFirst({ where: { predecessorId, successorId } })) throw conflict("Dependência já existe.");
  await ctx.db.taskDependency.create({ data: { organizationId: ctx.orgId, predecessorId, successorId } });
}

/** Aceite de entregável (pelo gestor com evidência, ou pelo cliente no portal). */
export async function decideDeliverable(ctx: Ctx, taskId: string, accept: boolean, byName: string, comment?: string) {
  if (!(can(ctx, "project.write") || can(ctx, "portal.approve"))) requirePerm(ctx, "project.write");
  requireWritable(ctx);
  const t = await ctx.db.projectTask.findFirst({ where: { id: taskId } });
  if (!t || !t.requiresAcceptance) throw notFound("Entregável");
  if (ctx.kind === "CLIENT") {
    const p = await ctx.db.project.findFirst({ where: { id: t.projectId } });
    if (p?.partyId !== ctx.partyId) throw notFound("Entregável");
  }
  if (t.acceptanceStatus === "ACCEPTED") throw rule("Entregável já aceito.");
  if (!accept && !comment?.trim()) throw validation("Informe o motivo da recusa.");
  await ctx.db.projectTask.update({ where: { id: taskId }, data: { acceptanceStatus: accept ? "ACCEPTED" : "REJECTED", acceptedAt: accept ? new Date() : null, acceptedByName: byName, acceptanceComment: comment ?? null, status: accept ? "DONE" : "IN_PROGRESS" } });
  // Marco contratual vinculado torna-se faturável
  if (accept) {
    const ms = await ctx.db.contractMilestone.findMany({ where: { projectTaskId: taskId, status: { in: ["PENDING", "READY"] } } });
    for (const m of ms) await ctx.db.contractMilestone.update({ where: { id: m.id }, data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedByName: byName } });
  }
  await audit(ctx, { action: accept ? "deliverable.accept" : "deliverable.reject", entity: "Project", entityId: t.projectId, reason: comment, changes: { task: t.wbsCode, by: byName } });
}

// ------------------------------------------------------------------ Equipe, riscos/decisões, status, ETC
export async function addMember(ctx: Ctx, projectId: string, professionalId: string, teamRoleId?: string, responsibility?: string) {
  requirePerm(ctx, "project.write");
  if (await ctx.db.projectMember.findFirst({ where: { projectId, professionalId } })) throw conflict("Profissional já está na equipe.");
  await ctx.db.projectMember.create({ data: { organizationId: ctx.orgId, projectId, professionalId, teamRoleId: teamRoleId ?? null, responsibility: responsibility ?? null } });
  await audit(ctx, { action: "project.member_add", entity: "Project", entityId: projectId, changes: { professionalId } });
}

export const logSchema = z.object({ projectId: z.string(), kind: z.enum(["RISK", "ISSUE", "DECISION", "PENDING", "CHANGE"]), title: zStr(3), description: zOptStr, probability: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(1).max(5).optional()), impact: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(1).max(5).optional()), ownerName: zOptStr, dueDate: zOptDate, clientVisible: zBool });
export async function addLog(ctx: Ctx, i: z.infer<typeof logSchema>) {
  requirePerm(ctx, "project.write");
  requireWritable(ctx);
  const l = await ctx.db.projectLog.create({ data: { organizationId: ctx.orgId, projectId: i.projectId, kind: i.kind, title: i.title, description: i.description ?? null, probability: i.probability ?? null, impact: i.impact ?? null, ownerName: i.ownerName ?? null, dueDate: i.dueDate ? civil(i.dueDate) : null, clientVisible: i.clientVisible, createdById: ctx.userId, status: i.kind === "DECISION" ? "CLOSED" : "OPEN" } });
  await audit(ctx, { action: "project.log", entity: "Project", entityId: i.projectId, changes: { kind: i.kind, title: i.title } });
  return l;
}
export async function setLogStatus(ctx: Ctx, id: string, status: "OPEN" | "MITIGATING" | "CLOSED") {
  requirePerm(ctx, "project.write");
  const l = await ctx.db.projectLog.findFirst({ where: { id } });
  if (!l) throw notFound("Registro");
  await ctx.db.projectLog.update({ where: { id }, data: { status } });
}

export const statusReportSchema = z.object({ projectId: z.string(), overall: z.enum(["GREEN", "YELLOW", "RED"]), schedule: z.enum(["GREEN", "YELLOW", "RED"]), budget: z.enum(["GREEN", "YELLOW", "RED"]), scope: z.enum(["GREEN", "YELLOW", "RED"]), summary: zStr(10, "Descreva o status (mín. 10 caracteres)"), nextSteps: zOptStr, clientVisible: zBool });
export async function addStatusReport(ctx: Ctx, i: z.infer<typeof statusReportSchema>) {
  requirePerm(ctx, "project.write");
  requireWritable(ctx);
  const r = await ctx.db.statusReport.create({ data: { organizationId: ctx.orgId, ...i, nextSteps: i.nextSteps ?? null, reportDate: civil(todayIn(ctx.timezone)), createdById: ctx.userId } });
  await audit(ctx, { action: "project.status_report", entity: "Project", entityId: i.projectId, changes: { overall: i.overall } });
  return r;
}

export const estimateSchema = z.object({ projectId: z.string(), remainingHours: zDecimal, remainingLaborCost: zDecimal, remainingThirdPartyUncommitted: zDecimal, remainingExpenses: zDecimal, remainingRevenue: zDecimal, notes: zOptStr });
export async function addEstimate(ctx: Ctx, i: z.infer<typeof estimateSchema>) {
  requirePerm(ctx, "project.write");
  requireWritable(ctx);
  for (const v of [i.remainingHours, i.remainingLaborCost, i.remainingThirdPartyUncommitted, i.remainingExpenses, i.remainingRevenue]) if (dec(v).lt(0)) throw validation("Valores da estimativa não podem ser negativos.");
  const e = await ctx.db.projectEstimate.create({ data: { organizationId: ctx.orgId, projectId: i.projectId, asOf: civil(todayIn(ctx.timezone)), remainingHours: qty(i.remainingHours), remainingLaborCost: money(i.remainingLaborCost), remainingThirdPartyUncommitted: money(i.remainingThirdPartyUncommitted), remainingExpenses: money(i.remainingExpenses), remainingRevenue: money(i.remainingRevenue), notes: i.notes ?? null, createdById: ctx.userId } });
  await audit(ctx, { action: "project.estimate", entity: "Project", entityId: i.projectId, changes: i });
  return e;
}

// ------------------------------------------------------------------ Encerramentos separados
export async function closeOperational(ctx: Ctx, id: string, reason?: string) {
  requirePerm(ctx, "project.write");
  requireWritable(ctx);
  const p = await ctx.db.project.findFirst({ where: { id } });
  if (!p) throw notFound("Projeto");
  const open = await ctx.db.projectTask.count({ where: { projectId: id, status: { not: "DONE" }, kind: { not: "PHASE" } } });
  const pendingAcc = await ctx.db.projectTask.count({ where: { projectId: id, requiresAcceptance: true, acceptanceStatus: { not: "ACCEPTED" } } });
  if ((open > 0 || pendingAcc > 0) && !reason?.trim()) throw rule(`Há ${open} atividade(s) abertas e ${pendingAcc} entregável(is) sem aceite. Informe justificativa para encerrar.`);
  await ctx.db.project.update({ where: { id }, data: { status: "COMPLETED", actualEnd: civil(todayIn(ctx.timezone)), operationalClosedAt: new Date() } });
  await audit(ctx, { action: "project.close_operational", entity: "Project", entityId: id, reason: reason ?? null, changes: { openTasks: open, pendingAcceptance: pendingAcc } });
}

/** Encerramento financeiro: exige operação encerrada, nada pendente de faturar e nenhuma conta a pagar aberta do projeto. */
export async function closeFinancial(ctx: Ctx, id: string) {
  requirePerm(ctx, "project.write");
  requirePerm(ctx, "margin.view");
  requireWritable(ctx);
  const p = await ctx.db.project.findFirst({ where: { id } });
  if (!p) throw notFound("Projeto");
  if (p.status !== "COMPLETED" && p.status !== "CANCELED") throw rule("Encerre a operação antes do encerramento financeiro.");
  const [eligibleTime, eligibleExp, openPay, openPo] = await Promise.all([
    ctx.db.timeEntry.count({ where: { projectId: id, billingStatus: { in: ["ELIGIBLE", "BLOCKED", "MEASURED"] } } }),
    ctx.db.expense.count({ where: { projectId: id, billingStatus: { in: ["ELIGIBLE", "MEASURED"] } } }),
    ctx.db.payable.count({ where: { projectId: id, status: { in: ["PENDING_APPROVAL", "OPEN", "PARTIAL"] } } }),
    ctx.db.purchaseOrder.count({ where: { projectId: id, status: { in: ["APPROVED", "PARTIALLY_RECEIVED", "PENDING_APPROVAL"] } } }),
  ]);
  const issues = [eligibleTime && `${eligibleTime} apontamento(s) não faturado(s)`, eligibleExp && `${eligibleExp} despesa(s) cobrável(is) não faturada(s)`, openPay && `${openPay} conta(s) a pagar em aberto`, openPo && `${openPo} pedido(s) de compra em aberto`].filter(Boolean);
  if (issues.length) throw rule(`Pendências para encerramento financeiro: ${issues.join("; ")}.`);
  await ctx.db.project.update({ where: { id }, data: { financialStatus: "CLOSED", financialClosedAt: new Date() } });
  await audit(ctx, { action: "project.close_financial", entity: "Project", entityId: id });
}

export async function currentBaseline(ctx: Ctx, projectId: string) {
  return ctx.db.projectBaseline.findFirst({ where: { projectId }, orderBy: { version: "desc" } });
}
export { monthStart, addMonths };
export function sumMoney(vals: unknown[]) {
  return money(sum(vals as string[]));
}
