/**
 * Comissões comerciais.
 * Base configurável por regra: contratação (BOOKING), faturamento (INVOICE) ou recebimento (RECEIPT).
 * Cancelamentos, estornos e perdas (inadimplência baixada) geram lançamentos de reversão — nunca exclusão.
 */
import type { Ctx } from "@/server/context";
import type { TenantTx } from "@/server/tenant-db";
import { requirePerm, requireWritable } from "@/server/context";
import { audit } from "@/server/audit";
import { civil, type CivilDate } from "@/lib/dates";
import { dec, money, type DecimalInput } from "@/lib/money";
import { notFound, rule } from "@/lib/errors";

export async function accrueCommissions(ctx: Ctx, tx: TenantTx, a: { basis: "BOOKING" | "INVOICE" | "RECEIPT"; contractId: string; sourceType: string; sourceId: string; baseAmount: DecimalInput; competence: CivilDate }) {
  const contract = await tx.contract.findFirst({ where: { id: a.contractId } });
  if (!contract) return [];
  const opp = contract.opportunityId ? await tx.opportunity.findFirst({ where: { id: contract.opportunityId } }) : null;
  const rules = await tx.commissionRule.findMany({ where: { basis: a.basis, active: true } });
  const created = [];
  for (const r of rules) {
    if (r.appliesToKind && r.appliesToKind !== (opp?.kind ?? "NEW")) continue;
    if (r.beneficiaryPartyId && r.beneficiaryPartyId !== opp?.partnerPartyId) continue;
    if (r.beneficiaryUserId && r.beneficiaryUserId !== opp?.ownerUserId) continue;
    const amount = money(dec(a.baseAmount).times(dec(r.ratePct)).div(100));
    if (amount.isZero()) continue;
    const exists = await tx.commissionEntry.findFirst({ where: { ruleId: r.id, sourceType: a.sourceType, sourceId: a.sourceId, kind: "ACCRUAL" } });
    if (exists) continue; // idempotente
    created.push(await tx.commissionEntry.create({ data: { organizationId: ctx.orgId, ruleId: r.id, contractId: a.contractId, sourceType: a.sourceType, sourceId: a.sourceId, baseAmount: money(a.baseAmount), amount, status: a.basis === "BOOKING" ? "ACCRUED" : "PAYABLE", competence: civil(a.competence) } }));
  }
  if (created.length) await audit(ctx, { action: "commission.accrue", entity: "Contract", entityId: a.contractId, changes: { basis: a.basis, source: `${a.sourceType}:${a.sourceId}`, entries: created.length } }, tx);
  return created;
}

/** Reverte comissões de uma origem (cancelamento, estorno, inadimplência). */
export async function reverseCommissions(ctx: Ctx, tx: TenantTx, sourceType: string, sourceId: string, competence: CivilDate, reason: string) {
  const entries = await tx.commissionEntry.findMany({ where: { sourceType, sourceId, kind: "ACCRUAL", status: { not: "REVERSED" } } });
  for (const e of entries) {
    await tx.commissionEntry.create({ data: { organizationId: ctx.orgId, ruleId: e.ruleId, contractId: e.contractId, sourceType, sourceId, baseAmount: e.baseAmount, amount: dec(e.amount).negated(), status: "REVERSED", kind: "REVERSAL", reversalOfId: e.id, competence: civil(competence) } });
    await tx.commissionEntry.update({ where: { id: e.id }, data: { status: "REVERSED" } });
  }
  if (entries.length) await audit(ctx, { action: "commission.reverse", entity: sourceType, entityId: sourceId, reason, changes: { entries: entries.length } }, tx);
  return entries.length;
}

export async function markCommissionPaid(ctx: Ctx, id: string) {
  requirePerm(ctx, "commission.manage");
  requireWritable(ctx);
  const e = await ctx.db.commissionEntry.findFirst({ where: { id } });
  if (!e) throw notFound("Comissão");
  if (e.status !== "PAYABLE" && e.status !== "ACCRUED") throw rule("Comissão não está a pagar.");
  await ctx.db.commissionEntry.update({ where: { id }, data: { status: "PAID" } });
  await audit(ctx, { action: "commission.paid", entity: "CommissionEntry", entityId: id });
}
