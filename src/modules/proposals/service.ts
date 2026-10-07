/**
 * Propostas versionadas. Uma versão aprovada é imutável (snapshot de valores e condições);
 * mudanças exigem nova versão, que volta ao rascunho e repassa pelas alçadas.
 */
import { z } from "zod";
import { requirePerm, requireWritable, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { nextNumber } from "@/server/sequences";
import { getSetting } from "@/server/settings";
import { notFound, rule, validation } from "@/lib/errors";
import { zDecimal, zOptDate, zOptId, zOptStr, zStr } from "@/lib/zod-helpers";
import { addDays, civil, todayIn } from "@/lib/dates";
import { dec, money, rate } from "@/lib/money";
import { priceProposal, type LineKind } from "@/domain/pricing";
import { openApprovals, registerApprovalHandler } from "../approvals/service";
import { referenceRate } from "../config/special";
import { winOpportunity } from "../crm/service";
import type { TenantTx } from "@/server/tenant-db";
import { notify, usersWithPermission } from "@/server/notify";

export const MODELS = ["FIXED_PRICE", "TIME_MATERIAL", "MONTHLY_ALLOCATION", "HOUR_PACKAGE", "AMS_RECURRING", "ADVISORY", "TRAINING", "HYBRID"] as const;

const arr = (v: unknown) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
export const versionSchema = z.object({
  commercialModel: z.enum(MODELS),
  scope: zOptStr, deliverables: zOptStr, assumptions: zOptStr, exclusions: zOptStr, schedule: zOptStr,
  startDate: zOptDate, endDate: zOptDate, months: z.coerce.number().int().min(1).max(120).default(1), validUntil: zOptDate,
  paymentTermId: zOptId, discountPct: zDecimal, taxRatePct: zDecimal,
  lineKind: z.preprocess(arr, z.array(z.string())), lineDescription: z.preprocess(arr, z.array(z.string())), lineServiceId: z.preprocess(arr, z.array(z.string())),
  lineTeamRoleId: z.preprocess(arr, z.array(z.string())), lineSeniorityId: z.preprocess(arr, z.array(z.string())), lineHours: z.preprocess(arr, z.array(z.string())),
  lineQuantity: z.preprocess(arr, z.array(z.string())), lineUnitPrice: z.preprocess(arr, z.array(z.string())), lineUnitCost: z.preprocess(arr, z.array(z.string())),
  lineBillable: z.preprocess(arr, z.array(z.string())),
});
export type VersionInput = z.infer<typeof versionSchema>;

export interface LineInput {
  kind: LineKind; description: string; serviceId?: string | null; teamRoleId?: string | null; seniorityId?: string | null;
  hours: string; quantity: string; unitPrice: string; unitCost: string; billable: boolean;
}

const norm = (s: string | undefined) => {
  const v = (s ?? "").trim();
  if (!v) return "0";
  return v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v;
};

export function linesFromForm(i: VersionInput): LineInput[] {
  const out: LineInput[] = [];
  i.lineKind.forEach((k, idx) => {
    const description = (i.lineDescription[idx] ?? "").trim();
    if (!k || !description) return;
    if (!["LABOR", "FIXED", "RECURRING", "EXPENSE", "THIRD_PARTY", "LICENSE"].includes(k)) throw validation("Tipo de linha inválido.");
    out.push({
      kind: k as LineKind, description, serviceId: i.lineServiceId[idx] || null, teamRoleId: i.lineTeamRoleId[idx] || null, seniorityId: i.lineSeniorityId[idx] || null,
      hours: norm(i.lineHours[idx]), quantity: norm(i.lineQuantity[idx] || "1"), unitPrice: norm(i.lineUnitPrice[idx]), unitCost: norm(i.lineUnitCost[idx]), billable: (i.lineBillable[idx] ?? "1") !== "0",
    });
  });
  for (const l of out) for (const v of [l.hours, l.quantity, l.unitPrice, l.unitCost]) if (!/^-?\d+(\.\d+)?$/.test(v)) throw validation(`Valor inválido na linha "${l.description}".`);
  return out;
}

async function writeVersion(ctx: Ctx, tx: TenantTx, versionId: string, i: VersionInput, lines: LineInput[]) {
  const totals = priceProposal(lines, i.discountPct, i.taxRatePct);
  await tx.proposalLine.deleteMany({ where: { versionId } });
  if (lines.length) {
    await tx.proposalLine.createMany({
      data: lines.map((l, idx) => ({
        organizationId: ctx.orgId, versionId, kind: l.kind, description: l.description, serviceId: l.serviceId, teamRoleId: l.teamRoleId, seniorityId: l.seniorityId,
        hours: dec(l.hours), quantity: dec(l.quantity), unitPrice: rate(l.unitPrice), unitCost: rate(l.unitCost), revenue: totals.lines[idx].revenue, cost: totals.lines[idx].cost, billable: l.billable, sortOrder: idx,
      })),
    });
  }
  await tx.proposalVersion.update({
    where: { id: versionId },
    data: {
      commercialModel: i.commercialModel, scope: i.scope ?? null, deliverables: i.deliverables ?? null, assumptions: i.assumptions ?? null, exclusions: i.exclusions ?? null, schedule: i.schedule ?? null,
      startDate: i.startDate ? civil(i.startDate) : null, endDate: i.endDate ? civil(i.endDate) : null, months: i.months, validUntil: i.validUntil ? civil(i.validUntil) : null,
      paymentTermId: i.paymentTermId ?? null, discountPct: dec(i.discountPct), taxRatePct: dec(i.taxRatePct),
      grossRevenue: totals.grossRevenue, discountAmount: totals.discountAmount, netRevenue: totals.netRevenue, taxAmount: totals.taxAmount, laborCost: totals.laborCost,
      thirdPartyCost: totals.thirdPartyCost, expenseCost: totals.expenseCost, totalCost: totals.totalCost, contributionMargin: totals.contributionMargin,
      marginPct: totals.marginPct ?? 0, markup: totals.markup ?? 0, totalHours: totals.totalHours,
    },
  });
  return totals;
}

export const createProposalSchema = z.object({ companyId: z.string().min(1), partyId: z.string().min(1), title: zStr(3), opportunityId: zOptId, commercialModel: z.enum(MODELS).default("TIME_MATERIAL") });

/** Cria proposta (v1). A partir de oportunidade, reaproveita cliente, itens e tarifas de referência vigentes. */
export async function createProposal(ctx: Ctx, i: z.infer<typeof createProposalSchema>) {
  requirePerm(ctx, "proposal.write");
  requireWritable(ctx);
  const party = await ctx.db.party.findFirst({ where: { id: i.partyId } });
  if (!party || !(party.isCustomer || party.isProspect)) throw validation("Cliente inválido.");
  const commercial = await getSetting(ctx, "commercial");
  const today = todayIn(ctx.timezone);
  const prefill: LineInput[] = [];
  let model = i.commercialModel;
  if (i.opportunityId) {
    const opp = await ctx.db.opportunity.findFirst({ where: { id: i.opportunityId } });
    if (!opp) throw notFound("Oportunidade");
    if (opp.partyId !== i.partyId) throw validation("Oportunidade de outro cliente.");
    const items = await ctx.db.opportunityItem.findMany({ where: { opportunityId: opp.id } });
    if (items.length === 1) model = items[0].commercialModel as typeof model;
    if (items.length > 1) model = "HYBRID";
    for (const it of items) {
      const svc = await ctx.db.service.findFirst({ where: { id: it.serviceId } });
      const ref = await referenceRate(ctx, today, { serviceId: it.serviceId });
      const unitPrice = ref?.rate ?? dec(0);
      const hours = unitPrice.gt(0) ? dec(it.estimatedValue).div(unitPrice).toDecimalPlaces(0) : dec(0);
      prefill.push(unitPrice.gt(0)
        ? { kind: "LABOR", description: svc?.name ?? "Serviço", serviceId: it.serviceId, hours: hours.toString(), quantity: "1", unitPrice: unitPrice.toString(), unitCost: (ref?.referenceCost ?? dec(0)).toString(), billable: true }
        : { kind: "FIXED", description: svc?.name ?? "Serviço", serviceId: it.serviceId, hours: "0", quantity: "1", unitPrice: dec(it.estimatedValue).toString(), unitCost: "0", billable: true });
    }
  }
  return ctx.db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "PROPOSAL");
    const p = await tx.proposal.create({ data: { organizationId: ctx.orgId, companyId: i.companyId, number, partyId: i.partyId, opportunityId: i.opportunityId ?? null, title: i.title, ownerUserId: ctx.userId } });
    const v = await tx.proposalVersion.create({ data: { organizationId: ctx.orgId, proposalId: p.id, version: 1, commercialModel: model, createdById: ctx.userId, validUntil: civil(addDays(today, commercial.defaultProposalValidityDays)), taxRatePct: dec(commercial.defaultTaxRatePct) } });
    if (prefill.length) {
      await writeVersion(ctx, tx, v.id, { commercialModel: model, discountPct: "0", taxRatePct: String(commercial.defaultTaxRatePct), months: 1, lineKind: [], lineDescription: [], lineServiceId: [], lineTeamRoleId: [], lineSeniorityId: [], lineHours: [], lineQuantity: [], lineUnitPrice: [], lineUnitCost: [], lineBillable: [], validUntil: addDays(today, commercial.defaultProposalValidityDays) } as VersionInput, prefill);
    }
    if (i.opportunityId) {
      const st = await tx.pipelineStage.findFirst({ where: { kind: "OPEN", name: "Proposta" } });
      if (st) await tx.opportunity.update({ where: { id: i.opportunityId }, data: { stageId: st.id, probability: st.probability, lastActivityAt: new Date() } });
    }
    await audit(ctx, { action: "proposal.create", entity: "Proposal", entityId: p.id, companyId: i.companyId }, tx);
    return p;
  });
}

async function currentVersion(ctx: Ctx | { db: TenantTx }, proposalId: string) {
  const db = "db" in ctx ? ctx.db : ctx;
  const p = await (db as TenantTx).proposal.findFirst({ where: { id: proposalId } });
  if (!p) throw notFound("Proposta");
  const v = await (db as TenantTx).proposalVersion.findFirst({ where: { proposalId, version: p.currentVersion } });
  return { p, v: v! };
}

export async function saveDraft(ctx: Ctx, proposalId: string, i: VersionInput) {
  requirePerm(ctx, "proposal.write");
  requireWritable(ctx);
  if (!ctx.permissions.has("cost.view") && !ctx.permissions.has("margin.view")) throw rule("Editar precificação exige acesso a custos ou margens (os custos não podem ser zerados por quem não os visualiza).");
  const lines = linesFromForm(i);
  return ctx.db.$transaction(async (tx) => {
    const p = await tx.proposal.findFirst({ where: { id: proposalId } });
    if (!p) throw notFound("Proposta");
    const v = await tx.proposalVersion.findFirstOrThrow({ where: { proposalId, version: p.currentVersion } });
    if (v.status !== "DRAFT" && v.status !== "REJECTED") throw rule("Versão aprovada/enviada é imutável. Crie uma nova versão para alterar.");
    if (v.status === "REJECTED") await tx.proposalVersion.update({ where: { id: v.id }, data: { status: "DRAFT" } });
    const totals = await writeVersion(ctx, tx, v.id, i, lines);
    await tx.proposal.update({ where: { id: proposalId }, data: { status: "DRAFT" } });
    await audit(ctx, { action: "proposal.save", entity: "Proposal", entityId: proposalId, changes: { version: v.version, net: totals.netRevenue.toFixed(2), margin: totals.marginPct?.toFixed(2) } }, tx);
    return totals;
  });
}

/** Nova versão a partir da atual (copia linhas). A anterior fica como "substituída". */
export async function newVersion(ctx: Ctx, proposalId: string) {
  requirePerm(ctx, "proposal.write");
  requireWritable(ctx);
  return ctx.db.$transaction(async (tx) => {
    const p = await tx.proposal.findFirst({ where: { id: proposalId } });
    if (!p) throw notFound("Proposta");
    if (p.status === "ACCEPTED") throw rule("Proposta aceita: alterações devem seguir por aditivo contratual.");
    const v = await tx.proposalVersion.findFirstOrThrow({ where: { proposalId, version: p.currentVersion } });
    if (v.status === "DRAFT") throw rule("A versão atual ainda está em rascunho.");
    const { id: _id, createdAt: _c, approvedAt: _a, approvedById: _b, acceptedAt: _d, acceptanceNote: _e, acceptedByName: _f, status: _s, version: _v, ...rest } = v;
    const nv = await tx.proposalVersion.create({ data: { ...rest, version: v.version + 1, status: "DRAFT", createdById: ctx.userId } });
    const lines = await tx.proposalLine.findMany({ where: { versionId: v.id } });
    if (lines.length) await tx.proposalLine.createMany({ data: lines.map(({ id: _i, versionId: _vv, ...l }) => ({ ...l, versionId: nv.id })) });
    if (v.status !== "REJECTED") await tx.proposalVersion.update({ where: { id: v.id }, data: { status: "SUPERSEDED" } });
    await tx.approvalRequest.updateMany({ where: { entity: "Proposal", entityId: proposalId, status: "PENDING" }, data: { status: "CANCELED" } });
    await tx.proposal.update({ where: { id: proposalId }, data: { currentVersion: nv.version, status: "DRAFT" } });
    await audit(ctx, { action: "proposal.new_version", entity: "Proposal", entityId: proposalId, changes: { from: v.version, to: nv.version } }, tx);
    return nv;
  });
}

/** Submete à aprovação conforme alçadas (desconto, margem, valor). Sem regra aplicável → aprovada. */
export async function submitProposal(ctx: Ctx, proposalId: string) {
  requirePerm(ctx, "proposal.write");
  requireWritable(ctx);
  const result = await ctx.db.$transaction(async (tx) => {
    const p = await tx.proposal.findFirst({ where: { id: proposalId } });
    if (!p) throw notFound("Proposta");
    const v = await tx.proposalVersion.findFirstOrThrow({ where: { proposalId, version: p.currentVersion } });
    if (v.status !== "DRAFT") throw rule("Somente rascunho pode ser submetido.");
    if (dec(v.netRevenue).lte(0)) throw rule("A proposta precisa ter receita líquida maior que zero.");
    if (!v.validUntil) throw rule("Informe a validade da proposta.");
    const { approved, matched } = await openApprovals(ctx, tx, { docType: "PROPOSAL", entity: "Proposal", entityId: proposalId, facts: { companyId: p.companyId, amount: v.netRevenue, discountPct: v.discountPct, marginPct: v.marginPct } });
    if (approved) await markApproved(ctx, tx, proposalId, "automática (dentro das alçadas)");
    else {
      await tx.proposalVersion.update({ where: { id: v.id }, data: { status: "PENDING_APPROVAL" } });
      await tx.proposal.update({ where: { id: proposalId }, data: { status: "PENDING_APPROVAL" } });
    }
    await audit(ctx, { action: "proposal.submit", entity: "Proposal", entityId: proposalId, changes: { version: v.version, approvalsRequired: matched.map((m) => m.reason) } }, tx);
    return { approved, matched };
  });
  if (!result.approved) {
    const perms = [...new Set(result.matched.map((m) => m.requiredPermission))];
    for (const perm of perms) await notify(ctx.orgId, await usersWithPermission(ctx.orgId, perm), { title: "Proposta aguardando aprovação", body: result.matched.map((m) => m.reason).join("; "), link: `/app/propostas/${proposalId}` });
  }
  return result;
}

async function markApproved(ctx: Ctx, tx: TenantTx, proposalId: string, how: string) {
  const p = await tx.proposal.findFirstOrThrow({ where: { id: proposalId } });
  await tx.proposalVersion.updateMany({ where: { proposalId, version: p.currentVersion }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: ctx.userId } });
  await tx.proposal.update({ where: { id: proposalId }, data: { status: "APPROVED" } });
  await audit(ctx, { action: "proposal.approved", entity: "Proposal", entityId: proposalId, changes: { how } }, tx);
}

registerApprovalHandler("Proposal", {
  label: "Proposta comercial",
  link: (id) => `/app/propostas/${id}`,
  onApproved: async (ctx, tx, id) => markApproved(ctx, tx, id, "alçada"),
  onRejected: async (ctx, tx, id, comment) => {
    const p = await tx.proposal.findFirstOrThrow({ where: { id } });
    await tx.proposalVersion.updateMany({ where: { proposalId: id, version: p.currentVersion }, data: { status: "REJECTED" } });
    await tx.proposal.update({ where: { id }, data: { status: "DRAFT" } });
    await audit(ctx, { action: "proposal.rejected_internal", entity: "Proposal", entityId: id, reason: comment }, tx);
  },
});

export async function markSent(ctx: Ctx, proposalId: string) {
  requireWritable(ctx);
  requirePerm(ctx, "proposal.write");
  const { p } = await currentVersion(ctx, proposalId);
  if (p.status !== "APPROVED") throw rule("Somente propostas aprovadas podem ser enviadas ao cliente.");
  await ctx.db.proposal.update({ where: { id: proposalId }, data: { status: "SENT" } });
  await audit(ctx, { action: "proposal.sent", entity: "Proposal", entityId: proposalId });
}

/**
 * Registra o aceite do cliente (sem simular assinatura certificada).
 * A comprovação (e-mail, PDF assinado externamente) é anexada à proposta.
 */
export async function registerAcceptance(ctx: Ctx, proposalId: string, i: { acceptedByName: string; note?: string; acceptedOn?: string }) {
  requirePerm(ctx, "proposal.write");
  requireWritable(ctx);
  if (!i.acceptedByName.trim()) throw validation("Informe quem aceitou pelo cliente.");
  const { p, v } = await currentVersion(ctx, proposalId);
  if (!["APPROVED", "SENT"].includes(p.status)) throw rule("A proposta precisa estar aprovada internamente para registrar o aceite.");
  if (v.validUntil && i.acceptedOn && i.acceptedOn > v.validUntil.toISOString().slice(0, 10)) throw rule("Aceite após a validade: emita nova versão.");
  await ctx.db.$transaction(async (tx) => {
    await tx.proposalVersion.update({ where: { id: v.id }, data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedByName: i.acceptedByName, acceptanceNote: i.note ?? null } });
    await tx.proposal.update({ where: { id: proposalId }, data: { status: "ACCEPTED" } });
    await audit(ctx, { action: "proposal.accepted", entity: "Proposal", entityId: proposalId, changes: { version: v.version, by: i.acceptedByName, net: v.netRevenue.toString() } }, tx);
  });
  if (p.opportunityId) await winOpportunity(ctx, p.opportunityId);
}

export async function rejectByClient(ctx: Ctx, proposalId: string, reason: string) {
  requireWritable(ctx);
  requirePerm(ctx, "proposal.write");
  if (!reason.trim()) throw validation("Informe o motivo.");
  const { p } = await currentVersion(ctx, proposalId);
  if (p.status === "ACCEPTED") throw rule("Proposta já aceita.");
  await ctx.db.proposal.update({ where: { id: proposalId }, data: { status: "REJECTED" } });
  await audit(ctx, { action: "proposal.client_rejected", entity: "Proposal", entityId: proposalId, reason });
}

export async function getProposal(ctx: Ctx, id: string, version?: number) {
  requirePerm(ctx, "crm.read");
  const p = await ctx.db.proposal.findFirst({ where: { id } });
  if (!p) return null;
  const versions = await ctx.db.proposalVersion.findMany({ where: { proposalId: id }, orderBy: { version: "desc" } });
  const v = versions.find((x) => x.version === (version ?? p.currentVersion))!;
  const lines = await ctx.db.proposalLine.findMany({ where: { versionId: v.id }, orderBy: { sortOrder: "asc" } });
  const showCost = ctx.permissions.has("cost.view") || ctx.permissions.has("margin.view");
  return { p, v, versions, lines: showCost ? lines : lines.map((l) => ({ ...l, unitCost: dec(0), cost: dec(0) })), showCost };
}

export function moneyOf(v: unknown) {
  return money(v as string);
}
