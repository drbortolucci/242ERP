/**
 * Motor de medição: reúne itens faturáveis com origem rastreável (tipo + id) e trava cada origem com BillingLock
 * (único por organização/tipo/chave). Concorrência ou repetição não duplica: a segunda medição falha na trava.
 *  - TIME_ENTRY: horas aprovadas e elegíveis (T&M e modelos por hora) × tarifa snapshot
 *  - MILESTONE: marcos aceitos
 *  - RECURRING_FEE / AMS_FEE: mensalidade por competência (chave contrato:AAAA-MM)
 *  - AMS_OVERAGE: excedente aprovado do banco de horas × tarifa de excedente
 *  - EXPENSE: despesas aprovadas cobráveis do cliente
 *  - ADJUSTMENT: ajuste manual justificado (sem trava de origem)
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requirePerm, requireWritable, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { nextNumber } from "@/server/sequences";
import { assertPeriodOpen } from "@/server/periods";
import { notify, usersWithPermission } from "@/server/notify";
import { conflict, notFound, rule, validation } from "@/lib/errors";
import { zDate, zOptStr } from "@/lib/zod-helpers";
import { addMonths, civil, monthStart, toCivil } from "@/lib/dates";
import { dec, money, qty, rate, sum } from "@/lib/money";
import { openApprovals, registerApprovalHandler } from "../approvals/service";
import type { TenantTx } from "@/server/tenant-db";

export interface Candidate { sourceType: string; sourceKey: string; sourceId: string | null; description: string; quantity: string; unitPrice: string; amount: string; serviceId: string | null; projectId: string | null; date: string }

/** Itens faturáveis do contrato no período que ainda não foram medidos. */
export async function billingCandidates(ctx: Ctx, contractId: string, periodStart: string, periodEnd: string): Promise<Candidate[]> {
  requirePerm(ctx, "billing.read");
  const c = await ctx.db.contract.findFirst({ where: { id: contractId } });
  if (!c) throw notFound("Contrato");
  const out: Candidate[] = [];
  const projects = await ctx.db.project.findMany({ where: { contractId }, select: { id: true } });
  const mainProject = projects[0]?.id ?? null;
  const [entries, milestones, expenses, overages, items] = await Promise.all([
    ctx.db.timeEntry.findMany({ where: { contractId, status: "APPROVED", billingStatus: "ELIGIBLE", date: { gte: civil(periodStart), lte: civil(periodEnd) } }, orderBy: { date: "asc" } }),
    ctx.db.contractMilestone.findMany({ where: { contractId, status: "ACCEPTED" } }),
    ctx.db.expense.findMany({ where: { status: "APPROVED", billingStatus: "ELIGIBLE", date: { lte: civil(periodEnd) }, OR: [{ contractId }, ...(projects.length ? [{ projectId: { in: projects.map((p) => p.id) } }] : [])] } }),
    c.commercialModel === "AMS_RECURRING" ? ctx.db.hourBankEntry.findMany({ where: { contractId, kind: "OVERAGE", overageStatus: "APPROVED", month: { lte: civil(periodEnd) } } }) : [],
    ctx.db.contractItem.findMany({ where: { contractId } }),
  ]);
  const profs = new Map((await ctx.db.professional.findMany({ where: { id: { in: entries.map((e) => e.professionalId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  for (const e of entries) {
    if (!e.sellRate) continue; // sem tarifa vigente: não mede (corrigir tarifa no contrato)
    out.push({ sourceType: "TIME_ENTRY", sourceKey: e.id, sourceId: e.id, description: `${toCivil(e.date).split("-").reverse().join("/")} ${profs.get(e.professionalId) ?? ""} — ${e.description}`, quantity: qty(e.hours).toFixed(2), unitPrice: rate(e.sellRate).toFixed(4), amount: money(dec(e.hours).times(e.sellRate)).toFixed(2), serviceId: null, projectId: e.projectId, date: toCivil(e.date) });
  }
  for (const m of milestones) out.push({ sourceType: "MILESTONE", sourceKey: m.id, sourceId: m.id, description: `Marco: ${m.name}`, quantity: "1.00", unitPrice: dec(m.amount).toFixed(4), amount: money(m.amount).toFixed(2), serviceId: null, projectId: mainProject, date: m.plannedDate ? toCivil(m.plannedDate) : periodEnd });
  // Mensalidades por competência dentro do período e da vigência
  const recurring = items.filter((i) => i.kind === "RECURRING");
  const monthly = c.commercialModel === "AMS_RECURRING" && c.monthlyFee ? dec(c.monthlyFee) : sum(recurring.map((i) => i.unitPrice));
  if (["AMS_RECURRING", "MONTHLY_ALLOCATION"].includes(c.commercialModel) && monthly.gt(0)) {
    const first = monthStart(toCivil(c.startDate) > periodStart ? toCivil(c.startDate) : periodStart);
    const lastDay = c.endDate && toCivil(c.endDate) < periodEnd ? toCivil(c.endDate) : periodEnd;
    for (let m = first; m <= lastDay; m = addMonths(m, 1)) {
      const type = c.commercialModel === "AMS_RECURRING" ? "AMS_FEE" : "RECURRING_FEE";
      out.push({ sourceType: type, sourceKey: `${c.id}:${m.slice(0, 7)}`, sourceId: c.id, description: `${c.commercialModel === "AMS_RECURRING" ? "Mensalidade AMS" : "Mensalidade de alocação"} — competência ${m.slice(5, 7)}/${m.slice(0, 4)}`, quantity: "1.00", unitPrice: monthly.toFixed(4), amount: money(monthly).toFixed(2), serviceId: recurring[0]?.serviceId ?? null, projectId: mainProject, date: m });
    }
  }
  for (const o of overages) {
    const h = dec(o.hours).negated();
    const r = dec(c.overageRate ?? 0);
    out.push({ sourceType: "AMS_OVERAGE", sourceKey: o.id, sourceId: o.id, description: `Excedente de horas AMS — ${toCivil(o.month).slice(5, 7)}/${toCivil(o.month).slice(0, 4)}`, quantity: qty(h).toFixed(2), unitPrice: r.toFixed(4), amount: money(h.times(r)).toFixed(2), serviceId: null, projectId: mainProject, date: toCivil(o.month) });
  }
  for (const e of expenses) out.push({ sourceType: "EXPENSE", sourceKey: e.id, sourceId: e.id, description: `Despesa reembolsável: ${e.description}`, quantity: "1.00", unitPrice: dec(e.billableAmount).toFixed(4), amount: money(e.billableAmount).toFixed(2), serviceId: null, projectId: e.projectId, date: toCivil(e.date) });
  // Remove o que já está travado (medido anteriormente)
  const locks = await ctx.db.billingLock.findMany({ where: { OR: out.map((o) => ({ sourceType: o.sourceType, sourceKey: o.sourceKey })) }, select: { sourceType: true, sourceKey: true } });
  const locked = new Set(locks.map((l) => `${l.sourceType}|${l.sourceKey}`));
  return out.filter((o) => !locked.has(`${o.sourceType}|${o.sourceKey}`));
}

async function setSourceStatus(tx: TenantTx, sourceType: string, sourceId: string | null, status: "ELIGIBLE" | "MEASURED" | "INVOICED") {
  if (!sourceId) return;
  if (sourceType === "TIME_ENTRY") await tx.timeEntry.update({ where: { id: sourceId }, data: { billingStatus: status } });
  if (sourceType === "EXPENSE") await tx.expense.update({ where: { id: sourceId }, data: { billingStatus: status } });
  if (sourceType === "MILESTONE") await tx.contractMilestone.update({ where: { id: sourceId }, data: { status: status === "INVOICED" ? "BILLED" : "ACCEPTED" } });
}

// ------------------------------------------------------------------ Criação
export const measurementSchema = z.object({ contractId: z.string().min(1), periodStart: zDate, periodEnd: zDate, competence: zDate, notes: zOptStr, keys: z.preprocess((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]), z.array(z.string()).optional()) });

/** Cria a medição com os itens escolhidos (chaves "TIPO|CHAVE"; omitido = todos os candidatos). */
export async function createMeasurement(ctx: Ctx, i: z.infer<typeof measurementSchema>) {
  requirePerm(ctx, "billing.measure");
  requireWritable(ctx);
  if (i.periodEnd < i.periodStart) throw validation("Período inválido.");
  const c = await ctx.db.contract.findFirst({ where: { id: i.contractId } });
  if (!c) throw notFound("Contrato");
  if (!["ACTIVE", "ENDED"].includes(c.status)) throw rule("Contrato não está ativo para medição.");
  let cands = await billingCandidates(ctx, c.id, i.periodStart, i.periodEnd);
  if (i.keys) { const ks = new Set(i.keys); cands = cands.filter((x) => ks.has(`${x.sourceType}|${x.sourceKey}`)); }
  if (!cands.length) throw rule("Nenhum item faturável disponível no período.");
  try {
    return await ctx.db.$transaction(async (tx) => {
      await assertPeriodOpen(tx, c.companyId, i.competence, "Medição");
      const number = await nextNumber(tx, ctx.orgId, "MEASUREMENT");
      const m = await tx.measurement.create({ data: { organizationId: ctx.orgId, companyId: c.companyId, number, partyId: c.partyId, contractId: c.id, periodStart: civil(i.periodStart), periodEnd: civil(i.periodEnd), competence: civil(monthStart(i.competence)), totalAmount: money(sum(cands.map((x) => x.amount))), notes: i.notes ?? null, createdById: ctx.userId } });
      for (const x of cands) {
        const item = await tx.measurementItem.create({ data: { organizationId: ctx.orgId, measurementId: m.id, sourceType: x.sourceType, sourceId: x.sourceId, description: x.description, quantity: x.quantity, unitPrice: x.unitPrice, amount: x.amount, serviceId: x.serviceId, projectId: x.projectId } });
        await tx.billingLock.create({ data: { organizationId: ctx.orgId, sourceType: x.sourceType, sourceKey: x.sourceKey, measurementItemId: item.id } });
        await setSourceStatus(tx, x.sourceType, x.sourceId, "MEASURED");
      }
      await audit(ctx, { action: "measurement.create", entity: "Measurement", entityId: m.id, companyId: c.companyId, changes: { items: cands.length, total: m.totalAmount.toString() } }, tx);
      return m;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict("Um ou mais itens já foram medidos por outra operação. Atualize e tente novamente.");
    throw e;
  }
}

export async function addAdjustment(ctx: Ctx, measurementId: string, description: string, amount: string) {
  requirePerm(ctx, "billing.measure");
  if (description.trim().length < 5) throw validation("Descreva e justifique o ajuste.");
  const a = money(amount);
  if (a.isZero()) throw validation("Informe o valor.");
  await ctx.db.$transaction(async (tx) => {
    const m = await tx.measurement.findFirst({ where: { id: measurementId } });
    if (!m || m.status !== "DRAFT") throw rule("Ajustes apenas em medição em rascunho.");
    await tx.measurementItem.create({ data: { organizationId: ctx.orgId, measurementId, sourceType: "ADJUSTMENT", description: description.trim(), quantity: 1, unitPrice: a, amount: a } });
    await recomputeTotal(tx, measurementId);
    await audit(ctx, { action: "measurement.adjustment", entity: "Measurement", entityId: measurementId, changes: { amount: a.toString() }, reason: description }, tx);
  });
}

export async function removeItem(ctx: Ctx, itemId: string) {
  requirePerm(ctx, "billing.measure");
  await ctx.db.$transaction(async (tx) => {
    const it = await tx.measurementItem.findFirst({ where: { id: itemId } });
    if (!it || it.status !== "ACTIVE") throw notFound("Item");
    const m = await tx.measurement.findFirstOrThrow({ where: { id: it.measurementId } });
    if (m.status !== "DRAFT") throw rule("Itens só podem ser removidos de medição em rascunho.");
    await tx.billingLock.deleteMany({ where: { measurementItemId: it.id } });
    await tx.measurementItem.update({ where: { id: it.id }, data: { status: "REMOVED" } });
    await setSourceStatus(tx, it.sourceType, it.sourceId, "ELIGIBLE");
    await recomputeTotal(tx, m.id);
    await audit(ctx, { action: "measurement.remove_item", entity: "Measurement", entityId: m.id, changes: { item: it.description } }, tx);
  });
}

async function recomputeTotal(tx: TenantTx, measurementId: string) {
  const items = await tx.measurementItem.findMany({ where: { measurementId, status: { not: "REMOVED" } } });
  await tx.measurement.update({ where: { id: measurementId }, data: { totalAmount: money(sum(items.map((i) => i.amount))) } });
}

// ------------------------------------------------------------------ Aprovação interna e do cliente
export async function submitMeasurement(ctx: Ctx, id: string) {
  requirePerm(ctx, "billing.measure");
  requireWritable(ctx);
  const r = await ctx.db.$transaction(async (tx) => {
    const m = await tx.measurement.findFirst({ where: { id } });
    if (!m || m.status !== "DRAFT") throw rule("Medição não está em rascunho.");
    if (dec(m.totalAmount).lte(0)) throw rule("Medição sem valor a faturar.");
    const { approved } = await openApprovals(ctx, tx, { docType: "MEASUREMENT", entity: "Measurement", entityId: id, facts: { companyId: m.companyId, amount: m.totalAmount } });
    await tx.measurement.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
    if (approved) await onApproved(ctx, tx, id);
    await audit(ctx, { action: "measurement.submit", entity: "Measurement", entityId: id }, tx);
    return approved;
  });
  if (!r) await notify(ctx.orgId, await usersWithPermission(ctx.orgId, "billing.approve"), { title: "Medição aguardando aprovação", link: `/app/faturamento/medicoes/${id}` });
  return r;
}

async function onApproved(ctx: Ctx, tx: TenantTx, id: string) {
  const m = await tx.measurement.findFirstOrThrow({ where: { id } });
  const c = await tx.contract.findFirstOrThrow({ where: { id: m.contractId } });
  await tx.measurement.update({ where: { id }, data: { status: c.requiresClientMeasurementApproval ? "CLIENT_PENDING" : "APPROVED", approvedById: ctx.userId, approvedAt: new Date() } });
}

registerApprovalHandler("Measurement", {
  label: "Medição",
  link: (id) => `/app/faturamento/medicoes/${id}`,
  onApproved,
  onRejected: async (ctx, tx, id, comment) => { await tx.measurement.update({ where: { id }, data: { status: "DRAFT" } }); await audit(ctx, { action: "measurement.rejected", entity: "Measurement", entityId: id, reason: comment }, tx); },
});

/** Aceite do cliente (portal ou registro interno com evidência). */
export async function clientApproveMeasurement(ctx: Ctx, id: string, byName: string) {
  if (ctx.kind === "CLIENT") requirePerm(ctx, "portal.approve");
  else requirePerm(ctx, "billing.approve");
  if (!byName.trim()) throw validation("Informe quem aprovou pelo cliente.");
  const m = await ctx.db.measurement.findFirst({ where: { id, ...(ctx.kind === "CLIENT" ? { partyId: ctx.partyId ?? "__none__" } : {}) } });
  if (!m || m.status !== "CLIENT_PENDING") throw rule("Medição não aguarda aprovação do cliente.");
  await ctx.db.measurement.update({ where: { id }, data: { status: "CLIENT_APPROVED", clientApprovedAt: new Date(), clientApprovedByName: byName.trim() } });
  await audit(ctx, { action: "measurement.client_approved", entity: "Measurement", entityId: id, changes: { byName } });
}

/** Cancela medição sem itens faturados: libera as travas e devolve as origens à elegibilidade. */
export async function cancelMeasurement(ctx: Ctx, id: string, reason: string) {
  requirePerm(ctx, "billing.measure");
  if (!reason.trim()) throw validation("Informe o motivo.");
  await ctx.db.$transaction(async (tx) => {
    const m = await tx.measurement.findFirst({ where: { id } });
    if (!m || ["CANCELED", "INVOICED", "PARTIALLY_INVOICED"].includes(m.status)) throw rule("Medição não pode ser cancelada (há itens faturados?).");
    const items = await tx.measurementItem.findMany({ where: { measurementId: id, status: "ACTIVE" } });
    for (const it of items) {
      await tx.billingLock.deleteMany({ where: { measurementItemId: it.id } });
      await tx.measurementItem.update({ where: { id: it.id }, data: { status: "REMOVED" } });
      await setSourceStatus(tx, it.sourceType, it.sourceId, "ELIGIBLE");
    }
    await tx.approvalRequest.updateMany({ where: { entity: "Measurement", entityId: id, status: "PENDING" }, data: { status: "CANCELED" } });
    await tx.measurement.update({ where: { id }, data: { status: "CANCELED" } });
    await audit(ctx, { action: "measurement.cancel", entity: "Measurement", entityId: id, reason }, tx);
  });
}

export { setSourceStatus };

/** Recusa do cliente: medição volta ao rascunho para correção (itens permanecem travados), com motivo auditado. */
export async function clientRejectMeasurement(ctx: Ctx, id: string, byName: string, reason: string) {
  if (ctx.kind === "CLIENT") requirePerm(ctx, "portal.approve");
  else requirePerm(ctx, "billing.approve");
  if (!reason.trim()) throw validation("Informe o motivo da recusa.");
  const m = await ctx.db.measurement.findFirst({ where: { id, ...(ctx.kind === "CLIENT" ? { partyId: ctx.partyId ?? "__none__" } : {}) } });
  if (!m || m.status !== "CLIENT_PENDING") throw rule("Medição não aguarda aprovação do cliente.");
  await ctx.db.measurement.update({ where: { id }, data: { status: "DRAFT", notes: `${m.notes ? `${m.notes}\n` : ""}Recusada por ${byName}: ${reason}` } });
  await audit(ctx, { action: "measurement.client_rejected", entity: "Measurement", entityId: id, reason, changes: { byName } });
  await notify(ctx.orgId, await usersWithPermission(ctx.orgId, "billing.measure"), { title: `Medição ${m.number} recusada pelo cliente`, body: reason, link: `/app/faturamento/medicoes/${id}` });
}
