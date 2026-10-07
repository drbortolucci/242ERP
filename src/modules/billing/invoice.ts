/**
 * Documento de cobrança (faturamento parcial ou total de uma medição aprovada).
 *  - Idempotente por chave (repetição devolve o mesmo documento); itens já faturados não podem ser faturados de novo.
 *  - Retenções: somente regras cadastradas/validadas pela empresa (o sistema não define alíquotas).
 *  - Títulos a receber pelo líquido, conforme a condição de pagamento (soma exata).
 *  - O documento de cobrança NÃO é nota fiscal; a NFS-e é solicitada ao provedor fiscal (simulado em desenvolvimento).
 */
import { z } from "zod";
import { requirePerm, requireWritable, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { nextNumber } from "@/server/sequences";
import { assertPeriodOpen } from "@/server/periods";
import { getSetting } from "@/server/settings";
import { conflict, notFound, rule, validation } from "@/lib/errors";
import { zDate, zOptStr } from "@/lib/zod-helpers";
import { civil, monthStart, toCivil, todayIn } from "@/lib/dates";
import { dec, money, sum } from "@/lib/money";
import { computeWithholdings, receivableInstallments } from "@/domain/billing";
import { accrueCommissions, reverseCommissions } from "../commissions/service";
import { setSourceStatus } from "./measurement";

export const invoiceSchema = z.object({
  measurementId: z.string().min(1), issueDate: zDate, idempotencyKey: z.string().min(8),
  itemIds: z.preprocess((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]), z.array(z.string()).optional()),
  discountAmount: z.preprocess((v) => (v === "" || v === undefined ? "0" : v), z.string()), customerPo: zOptStr, paymentTermId: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
});

export async function invoiceMeasurement(ctx: Ctx, i: z.infer<typeof invoiceSchema>) {
  requirePerm(ctx, "billing.issue");
  requireWritable(ctx);
  const existing = await ctx.db.billingDocument.findFirst({ where: { idempotencyKey: i.idempotencyKey } });
  if (existing) return existing; // repetição (duplo clique, reenvio): mesmo documento
  const settings = await getSetting(ctx, "billing");
  const doc = await ctx.db.$transaction(async (tx) => {
    const locked = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Measurement" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`, i.measurementId, ctx.orgId);
    if (!locked.length) throw notFound("Medição");
    const m = await tx.measurement.findFirstOrThrow({ where: { id: i.measurementId } });
    if (!["APPROVED", "CLIENT_APPROVED", "PARTIALLY_INVOICED"].includes(m.status)) throw rule(m.status === "CLIENT_PENDING" ? "Medição aguarda aprovação do cliente." : "Medição não está aprovada para faturamento.");
    const c = await tx.contract.findFirstOrThrow({ where: { id: m.contractId } });
    await assertPeriodOpen(tx, m.companyId, i.issueDate, "Faturamento");
    const open = await tx.measurementItem.findMany({ where: { measurementId: m.id, status: "ACTIVE" } });
    const items = i.itemIds ? open.filter((x) => i.itemIds!.includes(x.id)) : open;
    if (i.itemIds && items.length !== i.itemIds.length) throw conflict("Um ou mais itens já foram faturados ou removidos.");
    if (!items.length) throw rule("Selecione ao menos um item a faturar.");
    const itemsTotal = money(sum(items.map((x) => x.amount)));
    const discount = money(i.discountAmount || "0");
    if (discount.lt(0) || discount.gte(itemsTotal)) throw validation("Desconto inválido.");
    const gross = money(itemsTotal.minus(discount));
    // Ordem de compra do cliente: obrigatória quando o contrato exige; saldo não pode ser excedido
    let po = i.customerPo ?? null;
    if (c.requiresPo || po) {
      const pos = await tx.customerPurchaseOrder.findMany({ where: { contractId: c.id, active: true } });
      const chosen = po ? pos.find((p) => p.number === po) : pos[0];
      if (!chosen) throw rule("Contrato exige ordem de compra do cliente válida.");
      // trava a OC: emissões simultâneas de medições diferentes não podem ultrapassar o saldo
      await tx.$queryRawUnsafe(`SELECT id FROM "CustomerPurchaseOrder" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`, chosen.id, ctx.orgId);
      const used = sum((await tx.billingDocument.findMany({ where: { contractId: c.id, customerPo: chosen.number, status: "ISSUED" } })).map((d) => d.grossAmount));
      if (used.plus(gross).gt(dec(chosen.amount))) throw rule(`Saldo da OC ${chosen.number} insuficiente (disponível ${money(dec(chosen.amount).minus(used)).toFixed(2)}).`);
      po = chosen.number;
    }
    const rules = await tx.withholdingRule.findMany({ where: { active: true, OR: [{ companyId: m.companyId }, { companyId: null }] } });
    const wh = computeWithholdings(gross, rules.map((r) => ({ code: r.code, name: r.name, ratePct: r.ratePct, minBaseAmount: r.minBaseAmount, validFrom: toCivil(r.validFrom), validTo: r.validTo ? toCivil(r.validTo) : null })), i.issueDate);
    const number = await nextNumber(tx, ctx.orgId, "BILLING_DOCUMENT");
    const termId = i.paymentTermId ?? c.paymentTermId;
    const term = termId ? await tx.paymentTerm.findFirst({ where: { id: termId } }) : null;
    const doc = await tx.billingDocument.create({
      data: {
        organizationId: ctx.orgId, companyId: m.companyId, number, partyId: m.partyId, contractId: c.id, measurementId: m.id, customerPo: po, issueDate: civil(i.issueDate), competence: m.competence,
        grossAmount: gross, discountAmount: discount, withholdingAmount: wh.total, withholdings: wh.lines, netAmount: wh.net, idempotencyKey: i.idempotencyKey, paymentTermId: term?.id ?? null, createdById: ctx.userId,
      },
    });
    for (const it of items) {
      await tx.measurementItem.update({ where: { id: it.id }, data: { status: "INVOICED", billingDocumentId: doc.id } });
      await setSourceStatus(tx, it.sourceType, it.sourceId, "INVOICED");
    }
    const remaining = await tx.measurementItem.count({ where: { measurementId: m.id, status: "ACTIVE" } });
    await tx.measurement.update({ where: { id: m.id }, data: { status: remaining ? "PARTIALLY_INVOICED" : "INVOICED" } });
    const projectIds = [...new Set(items.map((x) => x.projectId).filter(Boolean))];
    for (const p of receivableInstallments(wh.net, i.issueDate, term ? (term.installments as { days: number; percent: string }[]) : null, settings.defaultDueDays)) {
      const n = await nextNumber(tx, ctx.orgId, "RECEIVABLE");
      await tx.receivable.create({ data: { organizationId: ctx.orgId, companyId: m.companyId, number: n, partyId: m.partyId, billingDocumentId: doc.id, contractId: c.id, projectId: projectIds.length === 1 ? projectIds[0] : null, installment: p.installment, installments: p.installments, issueDate: civil(i.issueDate), dueDate: civil(p.dueDate), competence: m.competence, amount: p.amount, openAmount: p.amount, description: `${number} — parcela ${p.installment}/${p.installments}` } });
    }
    await accrueCommissions(ctx, tx, { basis: "INVOICE", contractId: c.id, sourceType: "BILLING_DOCUMENT", sourceId: doc.id, baseAmount: gross, competence: toCivil(m.competence) });
    await audit(ctx, { action: "billing.issue", entity: "BillingDocument", entityId: doc.id, companyId: m.companyId, changes: { measurement: m.number, gross: gross.toString(), withholdings: wh.total.toString(), net: wh.net.toString(), items: items.length } }, tx);
    return doc;
  });
  return doc;
}

/** Cancelamento: só sem liquidações/créditos aplicados e sem NFS-e autorizada; itens voltam à medição. */
export async function cancelBillingDocument(ctx: Ctx, id: string, reason: string) {
  requirePerm(ctx, "billing.cancel");
  requireWritable(ctx);
  if (!reason.trim()) throw validation("Informe o motivo do cancelamento.");
  await ctx.db.$transaction(async (tx) => {
    const locked = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "BillingDocument" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`, id, ctx.orgId);
    if (!locked.length) throw notFound("Documento");
    const d = await tx.billingDocument.findFirstOrThrow({ where: { id } });
    if (d.status === "CANCELED") throw rule("Documento já cancelado.");
    if (["AUTHORIZED", "PENDING"].includes(d.fiscalStatus)) throw rule("Há NFS-e autorizada ou em processamento: cancele a nota no provedor fiscal antes.");
    await assertPeriodOpen(tx, d.companyId, toCivil(d.issueDate), "Cancelamento de faturamento");
    const recs = await tx.receivable.findMany({ where: { billingDocumentId: id } });
    if (recs.some((r) => !dec(r.openAmount).eq(dec(r.amount)) || r.status !== "OPEN")) throw rule("Há recebimentos, créditos ou compensações nos títulos: estorne-os antes.");
    await tx.receivable.updateMany({ where: { billingDocumentId: id }, data: { status: "CANCELED", openAmount: 0 } });
    const items = await tx.measurementItem.findMany({ where: { billingDocumentId: id } });
    for (const it of items) {
      await tx.measurementItem.update({ where: { id: it.id }, data: { status: "ACTIVE", billingDocumentId: null } });
      await setSourceStatus(tx, it.sourceType, it.sourceId, "MEASURED");
    }
    const m = await tx.measurement.findFirstOrThrow({ where: { id: d.measurementId } });
    const invoiced = await tx.measurementItem.count({ where: { measurementId: m.id, status: "INVOICED" } });
    await tx.measurement.update({ where: { id: m.id }, data: { status: invoiced ? "PARTIALLY_INVOICED" : m.clientApprovedAt ? "CLIENT_APPROVED" : "APPROVED" } });
    await tx.billingDocument.update({ where: { id }, data: { status: "CANCELED", cancelReason: reason, canceledAt: new Date() } });
    await reverseCommissions(ctx, tx, "BILLING_DOCUMENT", id, monthStart(todayIn(ctx.timezone)), reason);
    await audit(ctx, { action: "billing.cancel", entity: "BillingDocument", entityId: id, companyId: d.companyId, reason }, tx);
  });
}
