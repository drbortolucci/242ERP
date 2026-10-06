/**
 * Pedidos de venda, contratos, aditivos, mudanças de escopo, OCs do cliente, tarifas, marcos, saldos e alertas.
 * Rastreabilidade: oportunidade → proposta (versão) → pedido → contrato → projeto/AMS → medição → cobrança → recebimento.
 */
import { z } from "zod";
import { requirePerm, requireWritable, can, type Ctx } from "@/server/context";
import { audit, diff } from "@/server/audit";
import { nextNumber } from "@/server/sequences";
import { notFound, rule, validation, conflict } from "@/lib/errors";
import { zDate, zDecimal, zOptDate, zOptDecimal, zOptId, zOptStr, zStr, zBool } from "@/lib/zod-helpers";
import { addDays, civil, diffDays, toCivil, todayIn } from "@/lib/dates";
import { dec, money, rate, sum, pct } from "@/lib/money";
import { openApprovals, registerApprovalHandler } from "../approvals/service";
import { accrueCommissions } from "../commissions/service";
import type { TenantTx } from "@/server/tenant-db";

// ------------------------------------------------------------------ Pedido de venda
export async function createSalesOrderFromProposal(ctx: Ctx, proposalId: string, i: { orderDate: string; customerPo?: string; notes?: string }) {
  requirePerm(ctx, "contract.write");
  requireWritable(ctx);
  const p = await ctx.db.proposal.findFirst({ where: { id: proposalId } });
  if (!p) throw notFound("Proposta");
  if (p.status !== "ACCEPTED") throw rule("Somente propostas aceitas pelo cliente geram pedido de venda.");
  const v = await ctx.db.proposalVersion.findFirstOrThrow({ where: { proposalId, version: p.currentVersion } });
  if (await ctx.db.salesOrder.findFirst({ where: { proposalVersionId: v.id, status: { not: "CANCELED" } } })) throw conflict("Já existe pedido para esta versão da proposta.");
  return ctx.db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "SALES_ORDER");
    const so = await tx.salesOrder.create({
      data: { organizationId: ctx.orgId, companyId: p.companyId, number, partyId: p.partyId, proposalId: p.id, proposalVersionId: v.id, opportunityId: p.opportunityId, totalAmount: v.netRevenue, customerPo: i.customerPo ?? null, orderDate: civil(i.orderDate), notes: i.notes ?? null },
    });
    await audit(ctx, { action: "sales_order.create", entity: "SalesOrder", entityId: so.id, companyId: so.companyId, changes: { proposal: p.number, version: v.version, total: v.netRevenue.toString() } }, tx);
    return so;
  });
}

export async function cancelSalesOrder(ctx: Ctx, id: string, reason: string) {
  requirePerm(ctx, "contract.write");
  const so = await ctx.db.salesOrder.findFirst({ where: { id } });
  if (!so) throw notFound("Pedido");
  if (await ctx.db.contract.findFirst({ where: { salesOrderId: id, status: { not: "CANCELED" } } })) throw rule("Pedido já possui contrato. Cancele o contrato primeiro.");
  await ctx.db.salesOrder.update({ where: { id }, data: { status: "CANCELED" } });
  await audit(ctx, { action: "sales_order.cancel", entity: "SalesOrder", entityId: id, reason });
}

// ------------------------------------------------------------------ Contrato
export const contractSchema = z.object({
  title: zStr(3), commercialModel: z.string(), startDate: zDate, endDate: zOptDate,
  totalValue: zDecimal, hoursLimit: zOptDecimal, paymentTermId: zOptId,
  billingDay: z.coerce.number().int().min(1).max(28).default(1), billingFrequency: z.enum(["MONTHLY", "MILESTONE", "ON_DEMAND"]).default("MONTHLY"),
  requiresClientTimesheetApproval: zBool, requiresClientMeasurementApproval: zBool, requiresPo: zBool,
  overagePolicy: z.enum(["BLOCK", "BILL", "REQUIRE_APPROVAL"]).default("REQUIRE_APPROVAL"),
  revenueMethod: z.enum(["TIME_MATERIAL", "PERCENT_COMPLETE_HOURS", "MILESTONE", "STRAIGHT_LINE", "ON_MEASUREMENT"]),
  adjustmentIndex: zOptStr, adjustmentMonth: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(1).max(12).optional()),
  slaPolicyId: zOptId, monthlyFee: zOptDecimal, franchiseHours: zOptDecimal, overageRate: zOptDecimal,
  hourBankPolicy: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["NONE", "ACCUMULATE", "PREPAID"]).optional()), hourBankExpiryMonths: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(1).max(36).optional()),
  lowBalancePct: z.coerce.number().int().min(0).max(100).default(20), taxRatePct: zDecimal, ownerUserId: zOptId, businessUnitId: zOptId, costCenterId: zOptId,
  autoRenew: zBool, renewalNoticeDays: z.coerce.number().int().min(0).max(365).default(60),
});
export type ContractInput = z.infer<typeof contractSchema>;

function contractData(i: ContractInput) {
  return {
    title: i.title, commercialModel: i.commercialModel, startDate: civil(i.startDate), endDate: i.endDate ? civil(i.endDate) : null, totalValue: money(i.totalValue),
    hoursLimit: i.hoursLimit ? dec(i.hoursLimit) : null, paymentTermId: i.paymentTermId ?? null, billingDay: i.billingDay, billingFrequency: i.billingFrequency,
    requiresClientTimesheetApproval: i.requiresClientTimesheetApproval, requiresClientMeasurementApproval: i.requiresClientMeasurementApproval, requiresPo: i.requiresPo,
    overagePolicy: i.overagePolicy, revenueMethod: i.revenueMethod, adjustmentIndex: i.adjustmentIndex ?? null, adjustmentMonth: i.adjustmentMonth ?? null,
    slaPolicyId: i.slaPolicyId ?? null, monthlyFee: i.monthlyFee ? money(i.monthlyFee) : null, franchiseHours: i.franchiseHours ? dec(i.franchiseHours) : null,
    overageRate: i.overageRate ? rate(i.overageRate) : null, hourBankPolicy: i.hourBankPolicy ?? null, hourBankExpiryMonths: i.hourBankExpiryMonths ?? null,
    lowBalancePct: i.lowBalancePct, taxRatePct: dec(i.taxRatePct), ownerUserId: i.ownerUserId ?? null, businessUnitId: i.businessUnitId ?? null, costCenterId: i.costCenterId ?? null,
    autoRenew: i.autoRenew, renewalNoticeDays: i.renewalNoticeDays,
  };
}

function validateContract(i: ContractInput) {
  if (i.endDate && i.endDate < i.startDate) throw validation("Fim da vigência anterior ao início.");
  if (dec(i.totalValue).lt(0)) throw validation("Valor contratado inválido.");
  if (i.commercialModel === "AMS_RECURRING" && !i.monthlyFee && !i.franchiseHours) throw validation("Contrato AMS exige mensalidade e/ou franquia de horas.");
  if (i.franchiseHours && !i.overageRate && i.overagePolicy === "BILL") throw validation("Informe a tarifa de excedente para cobrar horas acima da franquia.");
}

/** Cria contrato a partir do pedido, com snapshot de itens e tarifas da proposta aceita. */
export async function createContractFromOrder(ctx: Ctx, salesOrderId: string, i: ContractInput) {
  requirePerm(ctx, "contract.write");
  requireWritable(ctx);
  validateContract(i);
  const so = await ctx.db.salesOrder.findFirst({ where: { id: salesOrderId } });
  if (!so || so.status === "CANCELED") throw notFound("Pedido de venda");
  if (await ctx.db.contract.findFirst({ where: { salesOrderId, status: { not: "CANCELED" } } })) throw conflict("Pedido já possui contrato.");
  const lines = so.proposalVersionId ? await ctx.db.proposalLine.findMany({ where: { versionId: so.proposalVersionId } }) : [];
  return ctx.db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "CONTRACT");
    const c = await tx.contract.create({ data: { organizationId: ctx.orgId, companyId: so.companyId, number, partyId: so.partyId, salesOrderId: so.id, opportunityId: so.opportunityId, proposalVersionId: so.proposalVersionId, ...contractData(i) } });
    if (lines.length) {
      await tx.contractItem.createMany({ data: lines.map((l) => ({ organizationId: ctx.orgId, contractId: c.id, serviceId: l.serviceId, description: l.description, kind: l.kind, quantity: l.kind === "LABOR" ? l.hours : l.quantity, unitPrice: l.unitPrice, amount: l.revenue })) });
      const seen = new Set<string>();
      for (const l of lines.filter((x) => x.kind === "LABOR" && dec(x.unitPrice).gt(0))) {
        const k = `${l.teamRoleId}|${l.seniorityId}`;
        if (seen.has(k)) continue;
        seen.add(k);
        await tx.contractRate.create({ data: { organizationId: ctx.orgId, contractId: c.id, teamRoleId: l.teamRoleId, seniorityId: l.seniorityId, hourlyRate: l.unitPrice, validFrom: civil(i.startDate), reason: "Snapshot da proposta aceita" } });
      }
    }
    if (so.customerPo) await tx.customerPurchaseOrder.create({ data: { organizationId: ctx.orgId, contractId: c.id, number: so.customerPo, amount: money(i.totalValue) } });
    await tx.salesOrder.update({ where: { id: so.id }, data: { status: "CONTRACTED" } });
    await audit(ctx, { action: "contract.create", entity: "Contract", entityId: c.id, companyId: c.companyId, changes: { from: so.number, value: i.totalValue, model: i.commercialModel } }, tx);
    return c;
  });
}

/** Contrato direto (sem proposta), ex.: renovação ou legado. */
export async function createContract(ctx: Ctx, i: ContractInput & { companyId: string; partyId: string }) {
  requirePerm(ctx, "contract.write");
  requireWritable(ctx);
  validateContract(i);
  const party = await ctx.db.party.findFirst({ where: { id: i.partyId, isCustomer: true } });
  if (!party) throw validation("Cliente inválido.");
  return ctx.db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "CONTRACT");
    const c = await tx.contract.create({ data: { organizationId: ctx.orgId, companyId: i.companyId, number, partyId: i.partyId, ...contractData(i) } });
    await audit(ctx, { action: "contract.create", entity: "Contract", entityId: c.id, companyId: c.companyId, changes: { value: i.totalValue, model: i.commercialModel } }, tx);
    return c;
  });
}

export async function updateContract(ctx: Ctx, id: string, i: ContractInput) {
  requirePerm(ctx, "contract.write");
  requireWritable(ctx);
  validateContract(i);
  const before = await ctx.db.contract.findFirst({ where: { id } });
  if (!before) throw notFound("Contrato");
  if (before.status !== "DRAFT") {
    // Contrato ativo: valor, vigência e limites só mudam por aditivo aprovado
    const locked = ["totalValue", "hoursLimit", "endDate", "startDate", "commercialModel", "monthlyFee", "franchiseHours", "overageRate"] as const;
    const next = contractData(i) as Record<string, unknown>;
    for (const k of locked) if (String(before[k] ?? "") !== String(next[k] ?? "")) throw rule(`Contrato ativo: "${k}" só pode ser alterado por aditivo aprovado.`);
  }
  const after = await ctx.db.contract.update({ where: { id }, data: contractData(i) });
  await audit(ctx, { action: "contract.update", entity: "Contract", entityId: id, companyId: after.companyId, changes: diff(before, after) });
  return after;
}

export async function activateContract(ctx: Ctx, id: string, i: { signedAt?: string; signatureEvidence?: string }) {
  requirePerm(ctx, "contract.write");
  requireWritable(ctx);
  const c = await ctx.db.contract.findFirst({ where: { id } });
  if (!c) throw notFound("Contrato");
  if (c.status !== "DRAFT" && c.status !== "SUSPENDED") throw rule("Contrato não está em rascunho/suspenso.");
  const updated = await ctx.db.$transaction(async (tx) => {
    const u = await tx.contract.update({ where: { id }, data: { status: "ACTIVE", signedAt: i.signedAt ? civil(i.signedAt) : c.signedAt, signatureEvidence: i.signatureEvidence ?? c.signatureEvidence } });
    if (c.status === "DRAFT") await accrueCommissions(ctx, tx, { basis: "BOOKING", contractId: id, sourceType: "CONTRACT", sourceId: id, baseAmount: c.totalValue, competence: todayIn(ctx.timezone) });
    await audit(ctx, { action: "contract.activate", entity: "Contract", entityId: id, companyId: c.companyId, changes: { signedAt: i.signedAt, evidence: i.signatureEvidence } }, tx);
    return u;
  });
  return updated;
}

export async function setContractStatus(ctx: Ctx, id: string, status: "SUSPENDED" | "ENDED" | "CANCELED", reason: string) {
  requirePerm(ctx, "contract.write");
  requireWritable(ctx);
  if (!reason.trim()) throw validation("Informe o motivo.");
  const c = await ctx.db.contract.findFirst({ where: { id } });
  if (!c) throw notFound("Contrato");
  await ctx.db.contract.update({ where: { id }, data: { status } });
  await audit(ctx, { action: `contract.${status.toLowerCase()}`, entity: "Contract", entityId: id, companyId: c.companyId, reason });
}

// ------------------------------------------------------------------ Tarifas (reajuste com vigência)
export const contractRateSchema = z.object({ contractId: z.string(), teamRoleId: zOptId, seniorityId: zOptId, professionalId: zOptId, hourlyRate: zDecimal, validFrom: zDate, reason: zOptStr });
export async function addContractRate(ctx: Ctx, i: z.infer<typeof contractRateSchema>) {
  requirePerm(ctx, "contract.write");
  requireWritable(ctx);
  if (dec(i.hourlyRate).lte(0)) throw validation("Tarifa inválida.");
  const key = { contractId: i.contractId, teamRoleId: i.teamRoleId ?? null, seniorityId: i.seniorityId ?? null, professionalId: i.professionalId ?? null };
  return ctx.db.$transaction(async (tx) => {
    const later = await tx.contractRate.findFirst({ where: { ...key, validFrom: { gte: civil(i.validFrom) } } });
    if (later) throw validation("Já existe tarifa com vigência igual ou posterior.");
    const open = await tx.contractRate.findFirst({ where: { ...key, validTo: null } });
    if (open) await tx.contractRate.update({ where: { id: open.id }, data: { validTo: civil(addDays(i.validFrom, -1)) } });
    const r = await tx.contractRate.create({ data: { organizationId: ctx.orgId, ...key, hourlyRate: rate(i.hourlyRate), validFrom: civil(i.validFrom), reason: i.reason ?? "Reajuste" } });
    await audit(ctx, { action: "contract_rate.create", entity: "Contract", entityId: i.contractId, changes: { ...key, rate: i.hourlyRate, validFrom: i.validFrom, previous: open?.hourlyRate?.toString() } }, tx);
    return r;
  });
}

type RateRow = { teamRoleId: string | null; seniorityId: string | null; professionalId: string | null; hourlyRate: unknown; validFrom: Date; validTo: Date | null };
/** Tarifa aplicável (mais específica e vigente): profissional > papel+senioridade > papel > senioridade > genérica. */
export function pickRate(rates: RateRow[], date: string, prof: { id: string; teamRoleId: string | null; seniorityId: string | null }) {
  const valid = rates.filter((r) => toCivil(r.validFrom) <= date && (!r.validTo || toCivil(r.validTo) >= date));
  const score = (r: RateRow) => {
    if (r.professionalId) return r.professionalId === prof.id ? 100 : -1;
    let s = 1;
    if (r.teamRoleId) s = r.teamRoleId === prof.teamRoleId ? s + 10 : -1;
    if (s > 0 && r.seniorityId) s = r.seniorityId === prof.seniorityId ? s + 5 : -1;
    return s;
  };
  const best = valid.map((r) => ({ r, s: score(r) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0];
  return best ? dec(best.r.hourlyRate as string) : null;
}

// ------------------------------------------------------------------ Marcos
export const milestoneSchema = z.object({ contractId: z.string(), name: zStr(2), amount: zDecimal, plannedDate: zOptDate, projectTaskId: zOptId });
export async function addMilestone(ctx: Ctx, i: z.infer<typeof milestoneSchema>) {
  requirePerm(ctx, "contract.write");
  requireWritable(ctx);
  const c = await ctx.db.contract.findFirst({ where: { id: i.contractId } });
  if (!c) throw notFound("Contrato");
  const existing = await ctx.db.contractMilestone.findMany({ where: { contractId: c.id, status: { not: "CANCELED" } } });
  const total = sum([...existing.map((m) => m.amount), i.amount]);
  if (total.gt(dec(c.totalValue))) throw rule(`Soma dos marcos (${total.toFixed(2)}) excede o valor contratado (${dec(c.totalValue).toFixed(2)}).`);
  const m = await ctx.db.contractMilestone.create({ data: { organizationId: ctx.orgId, contractId: c.id, name: i.name, amount: money(i.amount), plannedDate: i.plannedDate ? civil(i.plannedDate) : null, projectTaskId: i.projectTaskId ?? null } });
  await audit(ctx, { action: "milestone.create", entity: "Contract", entityId: c.id, changes: { name: i.name, amount: i.amount } });
  return m;
}

/** Aceite do marco pelo cliente (interno com evidência, ou via portal). Torna o marco faturável. */
export async function acceptMilestone(ctx: Ctx, id: string, acceptedByName: string) {
  if (!(ctx.permissions.has("contract.write") || ctx.permissions.has("project.write") || ctx.permissions.has("portal.approve"))) requirePerm(ctx, "contract.write");
  requireWritable(ctx);
  const m = await ctx.db.contractMilestone.findFirst({ where: { id } });
  if (!m) throw notFound("Marco");
  if (ctx.kind === "CLIENT") {
    const c = await ctx.db.contract.findFirst({ where: { id: m.contractId } });
    if (c?.partyId !== ctx.partyId) throw notFound("Marco");
  }
  if (m.status !== "PENDING" && m.status !== "READY") throw rule("Marco já aceito ou faturado.");
  await ctx.db.contractMilestone.update({ where: { id }, data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedByName } });
  await audit(ctx, { action: "milestone.accept", entity: "Contract", entityId: m.contractId, changes: { milestone: m.name, by: acceptedByName } });
}

// ------------------------------------------------------------------ Mudança de escopo e aditivos
export const changeRequestSchema = z.object({ contractId: zOptId, projectId: zOptId, title: zStr(3), description: zOptStr, effortHoursDelta: zDecimal, valueDelta: zDecimal, costDelta: zDecimal });
export async function createChangeRequest(ctx: Ctx, i: z.infer<typeof changeRequestSchema>) {
  if (!can(ctx, "contract.write") && !can(ctx, "project.write")) requirePerm(ctx, "contract.write");
  requireWritable(ctx);
  if (!i.contractId && !i.projectId) throw validation("Vincule a um contrato ou projeto.");
  let contractId = i.contractId ?? null;
  if (i.projectId) {
    const p = await ctx.db.project.findFirst({ where: { id: i.projectId } });
    if (!p) throw notFound("Projeto");
    contractId = contractId ?? p.contractId;
  }
  const cr = await ctx.db.changeRequest.create({ data: { organizationId: ctx.orgId, contractId, projectId: i.projectId ?? null, title: i.title, description: i.description ?? null, effortHoursDelta: dec(i.effortHoursDelta), valueDelta: money(i.valueDelta), costDelta: money(i.costDelta), requestedById: ctx.userId } });
  await audit(ctx, { action: "change_request.create", entity: "ChangeRequest", entityId: cr.id, changes: i });
  return cr;
}

export async function decideChangeRequest(ctx: Ctx, id: string, approve: boolean, comment?: string) {
  requirePerm(ctx, "contract.approve");
  requireWritable(ctx);
  const cr = await ctx.db.changeRequest.findFirst({ where: { id } });
  if (!cr) throw notFound("Solicitação de mudança");
  if (cr.status !== "OPEN") throw rule("Solicitação já decidida.");
  await ctx.db.changeRequest.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: ctx.userId } });
  await audit(ctx, { action: approve ? "change_request.approve" : "change_request.reject", entity: "ChangeRequest", entityId: id, reason: comment });
  // Mudança com impacto financeiro gera aditivo em rascunho
  if (approve && cr.contractId && (!dec(cr.valueDelta).isZero() || !dec(cr.effortHoursDelta).isZero())) {
    const a = await createAmendment(ctx, { contractId: cr.contractId, description: `Mudança de escopo: ${cr.title}`, valueDelta: cr.valueDelta.toString(), hoursDelta: cr.effortHoursDelta.toString(), changeRequestId: cr.id });
    await ctx.db.changeRequest.update({ where: { id }, data: { status: "CONVERTED", amendmentId: a.id } });
    return a;
  }
  return null;
}

export const amendmentSchema = z.object({ contractId: z.string(), description: zStr(3), valueDelta: zDecimal, hoursDelta: zDecimal, newEndDate: zOptDate, changeRequestId: zOptId });
export async function createAmendment(ctx: Ctx, i: z.infer<typeof amendmentSchema>) {
  if (!can(ctx, "contract.write") && !can(ctx, "contract.approve")) requirePerm(ctx, "contract.write");
  requireWritable(ctx);
  const c = await ctx.db.contract.findFirst({ where: { id: i.contractId } });
  if (!c) throw notFound("Contrato");
  if (c.status === "CANCELED" || c.status === "ENDED") throw rule("Contrato encerrado.");
  return ctx.db.$transaction(async (tx) => {
    const last = await tx.contractAmendment.findFirst({ where: { contractId: c.id }, orderBy: { number: "desc" } });
    const a = await tx.contractAmendment.create({ data: { organizationId: ctx.orgId, contractId: c.id, number: (last?.number ?? 0) + 1, description: i.description, valueDelta: money(i.valueDelta), hoursDelta: dec(i.hoursDelta), newEndDate: i.newEndDate ? civil(i.newEndDate) : null, changeRequestId: i.changeRequestId ?? null, createdById: ctx.userId } });
    await audit(ctx, { action: "amendment.create", entity: "Contract", entityId: c.id, companyId: c.companyId, changes: { number: a.number, valueDelta: i.valueDelta, hoursDelta: i.hoursDelta } }, tx);
    return a;
  });
}

export async function submitAmendment(ctx: Ctx, id: string) {
  requirePerm(ctx, "contract.write");
  requireWritable(ctx);
  return ctx.db.$transaction(async (tx) => {
    const a = await tx.contractAmendment.findFirst({ where: { id } });
    if (!a || a.status !== "DRAFT") throw rule("Aditivo não está em rascunho.");
    const c = await tx.contract.findFirstOrThrow({ where: { id: a.contractId } });
    const { approved } = await openApprovals(ctx, tx, { docType: "CONTRACT_AMENDMENT", entity: "ContractAmendment", entityId: id, facts: { companyId: c.companyId, amount: dec(a.valueDelta).abs() } });
    if (approved) {
      // Sem regra configurada: aditivos sempre exigem a permissão de aprovação contratual
      await tx.approvalRequest.create({ data: { organizationId: ctx.orgId, companyId: c.companyId, entity: "ContractAmendment", entityId: id, requiredPermission: "contract.approve", reasons: ["Aditivo contratual"], requestedById: ctx.userId } });
    }
    await tx.contractAmendment.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
    await audit(ctx, { action: "amendment.submit", entity: "Contract", entityId: a.contractId }, tx);
  });
}

async function applyAmendment(ctx: Ctx, tx: TenantTx, id: string) {
  const a = await tx.contractAmendment.findFirstOrThrow({ where: { id } });
  const c = await tx.contract.findFirstOrThrow({ where: { id: a.contractId } });
  const newTotal = dec(c.totalValue).plus(dec(a.valueDelta));
  if (newTotal.lt(0)) throw rule("Aditivo deixaria o valor contratado negativo.");
  await tx.contract.update({
    where: { id: c.id },
    data: { totalValue: money(newTotal), hoursLimit: c.hoursLimit ? dec(c.hoursLimit).plus(dec(a.hoursDelta)) : dec(a.hoursDelta).isZero() ? null : dec(a.hoursDelta), endDate: a.newEndDate ?? c.endDate, version: c.version + 1 },
  });
  await tx.contractAmendment.update({ where: { id }, data: { status: "APPROVED", approvedById: ctx.userId, approvedAt: new Date() } });
  await audit(ctx, { action: "amendment.approved", entity: "Contract", entityId: c.id, companyId: c.companyId, changes: { number: a.number, totalFrom: c.totalValue.toString(), totalTo: newTotal.toFixed(2), version: c.version + 1 } }, tx);
}

registerApprovalHandler("ContractAmendment", {
  label: "Aditivo contratual",
  link: (id) => `/app/contratos/aditivo/${id}`,
  onApproved: applyAmendment,
  onRejected: async (ctx, tx, id, comment) => {
    await tx.contractAmendment.update({ where: { id }, data: { status: "REJECTED" } });
    await audit(ctx, { action: "amendment.rejected", entity: "ContractAmendment", entityId: id, reason: comment }, tx);
  },
});

export const poSchema = z.object({ contractId: z.string(), number: zStr(1), amount: zDecimal, validFrom: zOptDate, validTo: zOptDate });
export async function addCustomerPo(ctx: Ctx, i: z.infer<typeof poSchema>) {
  requirePerm(ctx, "contract.write");
  requireWritable(ctx);
  if (await ctx.db.customerPurchaseOrder.findFirst({ where: { contractId: i.contractId, number: i.number } })) throw conflict("OC já cadastrada.");
  const po = await ctx.db.customerPurchaseOrder.create({ data: { organizationId: ctx.orgId, contractId: i.contractId, number: i.number, amount: money(i.amount), validFrom: i.validFrom ? civil(i.validFrom) : null, validTo: i.validTo ? civil(i.validTo) : null } });
  await audit(ctx, { action: "customer_po.create", entity: "Contract", entityId: i.contractId, changes: i });
  return po;
}

// ------------------------------------------------------------------ Saldos e alertas
/**
 * Saldos do contrato (docs/FORMULAS.md):
 *  Contratado = valor vigente (inclui aditivos aprovados)
 *  Executado  = Σ itens elegíveis/medidos de origem do contrato: horas aprovadas faturáveis × tarifa, marcos aceitos, mensalidades medidas, despesas cobráveis aprovadas
 *  Faturado   = Σ documentos de cobrança emitidos (bruto) não cancelados
 *  Recebido   = Σ principal liquidado dos títulos do contrato (líquido de estornos)
 *  Saldo disponível = Contratado − Executado ;  Executado não faturado = Executado − Faturado (mín. 0)
 */
export async function contractBalances(ctx: Ctx, contractId: string) {
  const c = await ctx.db.contract.findFirst({ where: { id: contractId } });
  if (!c) throw notFound("Contrato");
  const [entries, milestones, docs, recvs, expenses, measuredFees, hoursUsed] = await Promise.all([
    ctx.db.timeEntry.findMany({ where: { contractId, billable: true, status: "APPROVED", billingStatus: { in: ["ELIGIBLE", "MEASURED", "INVOICED", "BLOCKED"] } } }),
    ctx.db.contractMilestone.findMany({ where: { contractId, status: { in: ["ACCEPTED", "BILLED"] } } }),
    ctx.db.billingDocument.findMany({ where: { contractId, status: "ISSUED" } }),
    ctx.db.receivable.findMany({ where: { contractId, status: { not: "CANCELED" } } }),
    ctx.db.expense.findMany({ where: { contractId, status: "APPROVED", billableToClient: true } }),
    ctx.db.measurementItem.findMany({ where: { status: { not: "REMOVED" }, sourceType: { in: ["RECURRING_FEE", "AMS_FEE", "AMS_OVERAGE", "ALLOCATION", "PREPAID_PACKAGE", "SERVICE", "ADJUSTMENT"] }, measurementId: { in: (await ctx.db.measurement.findMany({ where: { contractId, status: { not: "CANCELED" } } })).map((m) => m.id) } } }),
    ctx.db.timeEntry.aggregate({ where: { contractId, status: "APPROVED" }, _sum: { hours: true } }),
  ]);
  const executedTime = sum(entries.map((e) => money(dec(e.hours).times(dec(e.sellRate ?? 0)))));
  const executed = money(sum([executedTime, ...milestones.map((m) => m.amount), ...expenses.map((e) => e.billableAmount), ...measuredFees.map((m) => m.amount)]));
  const billed = money(sum(docs.map((d) => d.grossAmount)));
  const received = money(sum(recvs.map((r) => dec(r.amount).minus(dec(r.openAmount)))));
  const contracted = money(c.totalValue);
  const available = contracted.minus(executed);
  return {
    contracted, executed, billed, received, available, unbilled: executed.gt(billed) ? executed.minus(billed) : money(0),
    availablePct: pct(available, contracted), hoursUsed: dec(hoursUsed._sum.hours ?? 0), hoursLimit: c.hoursLimit ? dec(c.hoursLimit) : null,
  };
}

export interface ContractAlert { contractId: string; number: string; kind: "EXPIRING" | "LOW_BALANCE" | "MISSING_PO" | "OVER_LIMIT" | "RENEWAL"; message: string }

export async function contractAlerts(ctx: Ctx, contractIds?: string[]) {
  const today = todayIn(ctx.timezone);
  const cs = await ctx.db.contract.findMany({ where: { status: "ACTIVE", ...(contractIds ? { id: { in: contractIds } } : {}) } });
  const out: ContractAlert[] = [];
  for (const c of cs) {
    if (c.endDate) {
      const left = diffDays(today, toCivil(c.endDate));
      if (left < 0) out.push({ contractId: c.id, number: c.number, kind: "EXPIRING", message: `Vigência encerrada há ${-left} dia(s) e contrato segue ativo.` });
      else if (left <= c.renewalNoticeDays) out.push({ contractId: c.id, number: c.number, kind: c.autoRenew ? "RENEWAL" : "EXPIRING", message: c.autoRenew ? `Renovação automática em ${left} dia(s).` : `Vence em ${left} dia(s). Avalie renovação.` });
    }
    const b = await contractBalances(ctx, c.id);
    if (b.contracted.gt(0) && b.availablePct !== null && b.availablePct.lt(c.lowBalancePct)) out.push({ contractId: c.id, number: c.number, kind: b.available.lt(0) ? "OVER_LIMIT" : "LOW_BALANCE", message: b.available.lt(0) ? `Execução excede o contratado em ${b.available.abs().toFixed(2)}. Política: ${c.overagePolicy}.` : `Saldo baixo: ${b.availablePct.toFixed(1)}% disponível.` });
    if (b.hoursLimit && b.hoursUsed.gt(b.hoursLimit)) out.push({ contractId: c.id, number: c.number, kind: "OVER_LIMIT", message: `Horas aprovadas (${b.hoursUsed}) acima do limite (${b.hoursLimit}).` });
    if (c.requiresPo) {
      const po = await ctx.db.customerPurchaseOrder.findFirst({ where: { contractId: c.id, active: true, OR: [{ validTo: null }, { validTo: { gte: civil(today) } }] } });
      if (!po) out.push({ contractId: c.id, number: c.number, kind: "MISSING_PO", message: "Contrato exige ordem de compra do cliente e não há OC vigente." });
    }
  }
  return out;
}

/** Renovação: nova oportunidade (RENEWAL) reaproveitando cliente, empresa e valor do contrato. */
export async function startRenewal(ctx: Ctx, contractId: string) {
  requirePerm(ctx, "crm.write");
  const c = await ctx.db.contract.findFirst({ where: { id: contractId } });
  if (!c) throw notFound("Contrato");
  const { createOpportunity } = await import("../crm/service");
  return createOpportunity(ctx, { companyId: c.companyId, partyId: c.partyId, title: `Renovação ${c.number} — ${c.title}`, estimatedValue: c.totalValue.toString(), kind: "RENEWAL", competitors: [], serviceIds: [], itemModels: [], itemValues: [], expectedCloseDate: c.endDate ? toCivil(c.endDate) : undefined });
}
