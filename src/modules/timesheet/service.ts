/**
 * Apontamento de horas.
 * Fluxo operacional: DRAFT → SUBMITTED → APPROVED (interno) | REJECTED (com motivo, volta para correção).
 * Fluxo comercial (separado): clientApproval NOT_REQUIRED|PENDING|APPROVED|REJECTED e
 * billingStatus NOT_BILLABLE | BLOCKED (aguarda cliente) | ELIGIBLE | MEASURED | INVOICED.
 * Custo/hora e tarifa vigentes na data são gravados (snapshot) na aprovação.
 * Correção de horas já faturadas: ajuste rastreável (novo apontamento vinculado), nunca edição.
 */
import { z } from "zod";
import { requirePerm, requireWritable, can, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { getSetting } from "@/server/settings";
import { assertPeriodOpen } from "@/server/periods";
import { forbidden, notFound, rule, validation, conflict } from "@/lib/errors";
import { zDate, zDecimal, zOptId, zOptStr, zBool } from "@/lib/zod-helpers";
import { addDays, civil, diffDays, toCivil, todayIn } from "@/lib/dates";
import { dec, money, qty, rate } from "@/lib/money";
import { costRateAt } from "../professionals/service";
import { pickRate } from "../contracts/service";
import { notify, usersWithPermission } from "@/server/notify";

/** Modelos em que cada hora aprovada é item de cobrança. */
export const HOURLY_BILLED_MODELS = ["TIME_MATERIAL", "HOUR_PACKAGE", "ADVISORY", "TRAINING", "HYBRID"];

export const timeEntrySchema = z.object({
  professionalId: zOptId, date: zDate, hours: zDecimal, description: z.string().trim().min(3, "Descreva a atividade"),
  activityType: z.enum(["WORK", "MEETING", "TRAVEL", "TRAINING", "SUPPORT", "INTERNAL"]).default("WORK"),
  billable: zBool, projectId: zOptId, taskId: zOptId, contractId: zOptId, ticketId: zOptId, internalCode: zOptStr,
});
export type TimeEntryInput = z.infer<typeof timeEntrySchema>;

async function resolveProfessional(ctx: Ctx, professionalId?: string) {
  const id = professionalId ?? ctx.professionalId;
  if (!id) throw validation("Seu usuário não está vinculado a um profissional. Solicite ao administrador.");
  if (id !== ctx.professionalId) requirePerm(ctx, "time.write_any");
  else requirePerm(ctx, "time.write");
  const p = await ctx.db.professional.findFirst({ where: { id } });
  if (!p || !p.active) throw validation("Profissional inválido ou inativo.");
  return p;
}

/** Determina contrato/empresa e faturabilidade a partir do contexto (projeto, chamado, contrato ou interno). */
async function resolveContext(ctx: Ctx, i: TimeEntryInput, profCompanyId: string) {
  const contexts = [i.projectId, i.ticketId, i.internalCode].filter(Boolean).length + (i.contractId && !i.projectId && !i.ticketId ? 1 : 0);
  if (contexts !== 1) throw validation("Informe exatamente um contexto: projeto, chamado AMS, contrato ou atividade interna.");
  let contractId: string | null = i.contractId ?? null;
  let projectId: string | null = i.projectId ?? null;
  let companyId = profCompanyId;
  let billableAllowed = true;
  if (i.projectId) {
    const p = await ctx.db.project.findFirst({ where: { id: i.projectId } });
    if (!p) throw validation("Projeto inválido.");
    if (["COMPLETED", "CANCELED"].includes(p.status)) throw rule("Projeto encerrado não aceita apontamentos.");
    contractId = p.contractId;
    companyId = p.companyId;
    billableAllowed = !!p.contractId;
    if (i.taskId) {
      const t = await ctx.db.projectTask.findFirst({ where: { id: i.taskId, projectId: p.id } });
      if (!t) throw validation("Atividade não pertence ao projeto.");
    }
  } else if (i.ticketId) {
    const t = await ctx.db.ticket.findFirst({ where: { id: i.ticketId } });
    if (!t) throw validation("Chamado inválido.");
    contractId = t.contractId;
    companyId = t.companyId;
    billableAllowed = !!t.contractId;
    // horas do chamado também compõem o custo do projeto de sustentação do contrato (quando existir)
    if (t.contractId) projectId = (await ctx.db.project.findFirst({ where: { contractId: t.contractId, status: { notIn: ["COMPLETED", "CANCELED"] } }, select: { id: true } }))?.id ?? null;
  } else if (contractId) {
    const c = await ctx.db.contract.findFirst({ where: { id: contractId } });
    if (!c) throw validation("Contrato inválido.");
    companyId = c.companyId;
  } else billableAllowed = false;
  if (contractId) {
    const c = await ctx.db.contract.findFirst({ where: { id: contractId } });
    if (c && c.status !== "ACTIVE") throw rule("Contrato não está ativo para apontamentos.");
  }
  return { contractId, projectId, companyId, billable: billableAllowed && i.billable };
}

async function validateLimits(ctx: Ctx, professionalId: string, date: string, hours: ReturnType<typeof dec>, exceptId?: string) {
  const ts = await getSetting(ctx, "timesheet");
  const today = todayIn(ctx.timezone);
  if (hours.lte(0)) throw validation("Quantidade de horas deve ser maior que zero.");
  if (hours.times(4).mod(1).gt(0)) throw validation("Use frações de 15 minutos (0,25 h).");
  if (diffDays(today, date) > ts.allowFutureDays) throw validation("Não é permitido apontar em datas futuras além do limite configurado.");
  if (diffDays(date, today) > ts.lockAfterDays && !can(ctx, "time.approve")) throw rule(`Apontamentos com mais de ${ts.lockAfterDays} dias exigem o gestor (período operacional bloqueado).`);
  const sameDay = await ctx.db.timeEntry.aggregate({ where: { professionalId, date: civil(date), status: { not: "REJECTED" }, adjustsEntryId: null, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, _sum: { hours: true } });
  const total = dec(sameDay._sum.hours ?? 0).plus(hours);
  if (total.gt(ts.maxHoursPerDay)) throw validation(`Total do dia (${total}h) excede o máximo permitido (${ts.maxHoursPerDay}h).`);
  return { overtime: total.gt(ts.overtimeAfterHoursPerDay) };
}

export async function createTimeEntry(ctx: Ctx, i: TimeEntryInput) {
  requireWritable(ctx);
  const prof = await resolveProfessional(ctx, i.professionalId);
  const hours = qty(i.hours);
  const { contractId, projectId, companyId, billable } = await resolveContext(ctx, i, prof.companyId);
  await assertPeriodOpen(ctx.db, companyId, i.date, "Apontamento");
  const { overtime } = await validateLimits(ctx, prof.id, i.date, hours);
  // Duplicidade: mesmo profissional, data, contexto, horas e descrição
  const dup = await ctx.db.timeEntry.findFirst({ where: { professionalId: prof.id, date: civil(i.date), projectId, ticketId: i.ticketId ?? null, taskId: i.taskId ?? null, hours, description: i.description, status: { not: "REJECTED" } } });
  if (dup) throw conflict("Apontamento duplicado: já existe lançamento idêntico nesta data.");
  const e = await ctx.db.timeEntry.create({
    data: {
      organizationId: ctx.orgId, companyId, professionalId: prof.id, date: civil(i.date), hours, description: i.description, activityType: i.activityType, billable, overtime,
      projectId, taskId: i.taskId ?? null, contractId, ticketId: i.ticketId ?? null, internalCode: i.internalCode ?? null, createdById: ctx.userId,
      billingStatus: billable ? "BLOCKED" : "NOT_BILLABLE",
    },
  });
  await audit(ctx, { action: "time.create", entity: "TimeEntry", entityId: e.id, companyId, changes: { date: i.date, hours: hours.toString(), billable } });
  return e;
}

export async function updateTimeEntry(ctx: Ctx, id: string, i: TimeEntryInput) {
  requireWritable(ctx);
  const e = await ctx.db.timeEntry.findFirst({ where: { id } });
  if (!e) throw notFound("Apontamento");
  if (!["DRAFT", "REJECTED"].includes(e.status)) throw rule("Somente rascunhos ou rejeitados podem ser editados.");
  await resolveProfessional(ctx, e.professionalId);
  const hours = qty(i.hours);
  const prof = await ctx.db.professional.findFirstOrThrow({ where: { id: e.professionalId } });
  const { contractId, projectId, companyId, billable } = await resolveContext(ctx, i, prof.companyId);
  await assertPeriodOpen(ctx.db, companyId, i.date, "Apontamento");
  const { overtime } = await validateLimits(ctx, e.professionalId, i.date, hours, id);
  await ctx.db.timeEntry.update({ where: { id }, data: { date: civil(i.date), hours, description: i.description, activityType: i.activityType, billable, overtime, projectId, taskId: i.taskId ?? null, ticketId: i.ticketId ?? null, contractId, companyId, internalCode: i.internalCode ?? null, status: "DRAFT", rejectionReason: null, clientApproval: "NOT_REQUIRED", billingStatus: billable ? "BLOCKED" : "NOT_BILLABLE" } });
  await audit(ctx, { action: "time.update", entity: "TimeEntry", entityId: id, changes: { hours: hours.toString(), date: i.date } });
}

export async function deleteDraftEntry(ctx: Ctx, id: string) {
  const e = await ctx.db.timeEntry.findFirst({ where: { id } });
  if (!e) throw notFound("Apontamento");
  if (e.status !== "DRAFT") throw rule("Somente rascunhos podem ser excluídos.");
  await resolveProfessional(ctx, e.professionalId);
  await ctx.db.timeEntry.delete({ where: { id } });
  await audit(ctx, { action: "time.delete_draft", entity: "TimeEntry", entityId: id });
}

export async function submitEntries(ctx: Ctx, ids: string[]) {
  requireWritable(ctx);
  let n = 0;
  for (const id of ids) {
    const e = await ctx.db.timeEntry.findFirst({ where: { id } });
    if (!e || !["DRAFT", "REJECTED"].includes(e.status)) continue;
    await resolveProfessional(ctx, e.professionalId);
    await assertPeriodOpen(ctx.db, e.companyId, e.date, "Envio de apontamento");
    await ctx.db.timeEntry.update({ where: { id }, data: { status: "SUBMITTED", submittedAt: new Date(), rejectionReason: null } });
    n++;
  }
  if (n) await notify(ctx.orgId, await usersWithPermission(ctx.orgId, "time.approve"), { title: `${n} apontamento(s) aguardando aprovação`, link: "/app/horas/aprovacao" });
  await audit(ctx, { action: "time.submit", entity: "TimeEntry", changes: { count: n } });
  return n;
}

/** Aprovação interna: grava snapshots de custo e tarifa; define elegibilidade comercial. */
export async function approveEntries(ctx: Ctx, ids: string[]) {
  requirePerm(ctx, "time.approve");
  requireWritable(ctx);
  const sod = await getSetting(ctx, "sod");
  let n = 0;
  for (const id of ids) {
    await ctx.db.$transaction(async (tx) => {
      const e = await tx.timeEntry.findFirst({ where: { id } });
      if (!e || e.status !== "SUBMITTED") return;
      if (sod.requesterCannotApprove && e.professionalId === ctx.professionalId) throw forbidden("Segregação de funções: você não pode aprovar as próprias horas.");
      await assertPeriodOpen(tx, e.companyId, e.date, "Aprovação de apontamento");
      const date = toCivil(e.date);
      const cost = await costRateAt(tx, e.professionalId, date);
      let sell: ReturnType<typeof dec> | null = null;
      let clientApproval = "NOT_REQUIRED";
      let hourlyBilled = false;
      if (e.contractId) {
        const c = await tx.contract.findFirstOrThrow({ where: { id: e.contractId } });
        const prof = await tx.professional.findFirstOrThrow({ where: { id: e.professionalId } });
        const rates = await tx.contractRate.findMany({ where: { contractId: c.id } });
        sell = pickRate(rates, date, prof) ?? (c.overageRate && e.ticketId ? dec(c.overageRate) : null);
        hourlyBilled = HOURLY_BILLED_MODELS.includes(c.commercialModel);
        if (e.billable && hourlyBilled && c.requiresClientTimesheetApproval) clientApproval = "PENDING";
      }
      // Em preço fechado, alocação mensal e AMS, horas não são cobradas individualmente (cobertas por marcos/mensalidade/franquia)
      const billingStatus = !e.billable || !hourlyBilled ? "NOT_BILLABLE" : clientApproval === "PENDING" ? "BLOCKED" : "ELIGIBLE";
      await tx.timeEntry.update({
        where: { id },
        data: { status: "APPROVED", approvedById: ctx.userId, approvedAt: new Date(), costRate: cost ? rate(cost) : null, costAmount: cost ? money(cost.times(dec(e.hours))) : null, sellRate: sell ? rate(sell) : null, clientApproval, billingStatus },
      });
      await audit(ctx, { action: "time.approve", entity: "TimeEntry", entityId: id, companyId: e.companyId, changes: { hours: e.hours.toString(), costRate: cost?.toString() ?? null, sellRate: sell?.toString() ?? null, clientApproval } }, tx);
      n++;
    });
  }
  // AMS: horas aprovadas consomem o banco de horas do contrato (FIFO, idempotente)
  if (n) await (await import("@/modules/ams/hour-bank")).syncContractsOfEntries(ctx, ids);
  return n;
}

export async function rejectEntries(ctx: Ctx, ids: string[], reason: string) {
  requirePerm(ctx, "time.approve");
  if (!reason.trim()) throw validation("Informe o motivo da rejeição.");
  let n = 0;
  for (const id of ids) {
    const e = await ctx.db.timeEntry.findFirst({ where: { id } });
    if (!e || e.status !== "SUBMITTED") continue;
    await ctx.db.timeEntry.update({ where: { id }, data: { status: "REJECTED", rejectionReason: reason } });
    await audit(ctx, { action: "time.reject", entity: "TimeEntry", entityId: id, reason });
    n++;
  }
  return n;
}

/** Aprovação do cliente (portal ou registrada internamente com evidência). Rejeição volta para correção. */
export async function clientDecision(ctx: Ctx, ids: string[], approve: boolean, byName: string, reason?: string) {
  if (!can(ctx, "portal.approve") && !can(ctx, "time.approve")) throw forbidden();
  requireWritable(ctx);
  if (!approve && !reason?.trim()) throw validation("Informe o motivo.");
  let n = 0;
  for (const id of ids) {
    const e = await ctx.db.timeEntry.findFirst({ where: { id } });
    if (!e || e.clientApproval !== "PENDING") continue;
    if (ctx.kind === "CLIENT") {
      const c = e.contractId ? await ctx.db.contract.findFirst({ where: { id: e.contractId } }) : null;
      if (c?.partyId !== ctx.partyId) continue;
    }
    await ctx.db.timeEntry.update({
      where: { id },
      data: approve
        ? { clientApproval: "APPROVED", clientApprovedAt: new Date(), clientApprovedByName: byName, billingStatus: "ELIGIBLE" }
        : { clientApproval: "REJECTED", status: "REJECTED", rejectionReason: `Cliente: ${reason}`, billingStatus: "BLOCKED" },
    });
    await audit(ctx, { action: approve ? "time.client_approve" : "time.client_reject", entity: "TimeEntry", entityId: id, reason: reason ?? null, changes: { by: byName } });
    n++;
  }
  return n;
}

/**
 * Ajuste rastreável de horas já medidas/faturadas: cria apontamento vinculado (positivo ou negativo),
 * aprovado pelo gestor e elegível para a próxima medição (crédito/débito ao cliente). O original não é alterado.
 */
export async function createAdjustment(ctx: Ctx, entryId: string, deltaHours: string, reason: string) {
  requirePerm(ctx, "time.approve");
  requireWritable(ctx);
  if (!reason.trim()) throw validation("Informe o motivo do ajuste.");
  const d = qty(deltaHours);
  if (d.isZero()) throw validation("Informe a diferença de horas.");
  const e = await ctx.db.timeEntry.findFirst({ where: { id: entryId } });
  if (!e) throw notFound("Apontamento");
  if (!["MEASURED", "INVOICED"].includes(e.billingStatus) && e.status !== "APPROVED") throw rule("Ajuste se aplica a apontamentos aprovados/faturados; para os demais, edite ou rejeite.");
  const prior = await ctx.db.timeEntry.aggregate({ where: { adjustsEntryId: entryId }, _sum: { hours: true } });
  if (dec(e.hours).plus(dec(prior._sum.hours ?? 0)).plus(d).lt(0)) throw rule("O ajuste deixaria as horas totais negativas.");
  const today = todayIn(ctx.timezone);
  await assertPeriodOpen(ctx.db, e.companyId, today, "Ajuste de apontamento");
  const adj = await ctx.db.timeEntry.create({
    data: {
      organizationId: ctx.orgId, companyId: e.companyId, professionalId: e.professionalId, date: civil(today), hours: d, description: `Ajuste de ${toCivil(e.date)}: ${reason}`, activityType: e.activityType, billable: e.billable,
      projectId: e.projectId, taskId: e.taskId, contractId: e.contractId, ticketId: e.ticketId, internalCode: e.internalCode, status: "APPROVED", approvedById: ctx.userId, approvedAt: new Date(),
      costRate: e.costRate, costAmount: e.costRate ? money(dec(e.costRate).times(d)) : null, sellRate: e.sellRate, billingStatus: e.billable ? "ELIGIBLE" : "NOT_BILLABLE", adjustsEntryId: e.id, adjustmentReason: reason, createdById: ctx.userId,
    },
  });
  await audit(ctx, { action: "time.adjustment", entity: "TimeEntry", entityId: adj.id, reason, changes: { original: entryId, delta: d.toString() } });
  return adj;
}

/** Explica por que um apontamento ainda não pode ser faturado e como resolver. */
export function billingBlockReason(e: { billable: boolean; status: string; clientApproval: string; billingStatus: string; sellRate: unknown; contractId: string | null }): { reason: string; action: string } | null {
  if (!e.billable) return { reason: "Apontamento não faturável.", action: "Nenhuma (horas internas/não cobráveis)." };
  if (e.status === "APPROVED" && e.billingStatus === "NOT_BILLABLE") return { reason: "Coberto pelo modelo do contrato (marcos, mensalidade ou franquia AMS).", action: "Nenhuma — faturado via marcos/mensalidade; excedente AMS é apurado pelo banco de horas." };
  if (!e.contractId) return { reason: "Sem contrato vinculado.", action: "Vincule o projeto/chamado a um contrato." };
  if (e.status === "DRAFT") return { reason: "Rascunho não enviado.", action: "O profissional deve enviar para aprovação." };
  if (e.status === "SUBMITTED") return { reason: "Aguardando aprovação interna.", action: "Gestor deve aprovar em Horas › Aprovação." };
  if (e.status === "REJECTED") return { reason: "Rejeitado.", action: "Corrigir e reenviar." };
  if (e.clientApproval === "PENDING") return { reason: "Aguardando aprovação do cliente.", action: "Cliente aprova no portal (ou registrar aprovação com evidência)." };
  if (!e.sellRate) return { reason: "Sem tarifa vigente no contrato para o perfil.", action: "Cadastre a tarifa do perfil/profissional no contrato." };
  if (e.billingStatus === "MEASURED") return { reason: "Já incluído em medição.", action: "Aprovar a medição e emitir a cobrança." };
  if (e.billingStatus === "INVOICED") return { reason: "Já faturado.", action: "Para corrigir, use ajuste rastreável." };
  return null;
}

export function weekDays(start: string) {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
