/**
 * Suprimentos: requisição → cotação → comparação → aprovação → pedido/contratação → recebimento/aceite →
 * documento do fornecedor (conferência de 3 vias) → contas a pagar → pagamento (financeiro).
 * Compras alimentam custos do projeto (NF aprovada), compromissos (pedido aprovado não faturado) e previsão de caixa.
 */
import { z } from "zod";
import { requirePerm, requireWritable, requireAnyPerm, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { nextNumber } from "@/server/sequences";
import { assertPeriodOpen } from "@/server/periods";
import { conflict, forbidden, notFound, rule, validation } from "@/lib/errors";
import { zDate, zDecimal, zOptDate, zOptId, zOptStr, zStr } from "@/lib/zod-helpers";
import { addDays, civil, monthStart, toCivil, todayIn } from "@/lib/dates";
import { dec, money, qty, rate, sum } from "@/lib/money";
import { openApprovals, registerApprovalHandler } from "../approvals/service";
import { threeWayMatch } from "@/domain/three-way-match";
import type { TenantTx } from "@/server/tenant-db";
import { notify, usersWithPermission } from "@/server/notify";

const arr = (v: unknown) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const KINDS = ["SERVICE", "PROFESSIONAL", "LICENSE", "SUBSCRIPTION", "EQUIPMENT", "MATERIAL"] as const;

// ------------------------------------------------------------------ Requisição
export const requisitionSchema = z.object({
  companyId: z.string().min(1), costCenterId: zOptId, projectId: zOptId, accountId: zOptId, description: zStr(3), justification: zOptStr, neededBy: zOptDate,
  lineKind: z.preprocess(arr, z.array(z.string())), lineDescription: z.preprocess(arr, z.array(z.string())), lineQuantity: z.preprocess(arr, z.array(z.string())), lineUnit: z.preprocess(arr, z.array(z.string())), linePrice: z.preprocess(arr, z.array(z.string())),
});
export type RequisitionInput = z.infer<typeof requisitionSchema>;

const n = (s: string | undefined) => { const v = (s ?? "").trim(); return v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v || "0"; };

/**
 * Verificação de orçamento:
 *  projeto → saldo de terceiros da linha de base vigente − (comprometido + realizado em compras do projeto)
 *  centro de custo/conta → orçamento anual aprovado − (compromissos + realizado no razão) do ano
 */
export async function budgetCheck(ctx: Ctx, i: { projectId?: string | null; costCenterId?: string | null; accountId?: string | null; companyId: string; amount: string; exceptPoId?: string }) {
  const amount = money(i.amount);
  if (i.projectId) {
    const bl = await ctx.db.projectBaseline.findFirst({ where: { projectId: i.projectId }, orderBy: { version: "desc" } });
    const pos = await ctx.db.purchaseOrder.findMany({ where: { projectId: i.projectId, status: { in: ["PENDING_APPROVAL", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"] }, ...(i.exceptPoId ? { NOT: { id: i.exceptPoId } } : {}) } });
    const used = money(sum(pos.map((p) => p.totalAmount)));
    const budget = money(bl?.thirdPartyCost ?? 0);
    const available = budget.minus(used);
    return { scope: "Projeto (terceiros da linha de base vigente)", budget: budget.toFixed(2), used: used.toFixed(2), available: available.toFixed(2), requested: amount.toFixed(2), ok: available.gte(amount), hasBudget: !!bl };
  }
  if (i.costCenterId && i.accountId) {
    const year = Number(todayIn(ctx.timezone).slice(0, 4));
    const budget = await ctx.db.budget.findFirst({ where: { companyId: i.companyId, year, kind: "BUDGET", status: "APPROVED" }, orderBy: { version: "desc" } });
    const lines = budget ? await ctx.db.budgetLine.findMany({ where: { budgetId: budget.id, costCenterId: i.costCenterId, accountId: i.accountId } }) : [];
    const b = money(sum(lines.map((l) => l.amount)));
    const pos = await ctx.db.purchaseOrder.findMany({ where: { costCenterId: i.costCenterId, accountId: i.accountId, status: { in: ["PENDING_APPROVAL", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"] }, orderDate: { gte: civil(`${year}-01-01`) }, ...(i.exceptPoId ? { NOT: { id: i.exceptPoId } } : {}) } });
    const used = money(sum(pos.map((p) => p.totalAmount)));
    const available = b.minus(used);
    return { scope: `Centro de custo/conta (orçamento ${year})`, budget: b.toFixed(2), used: used.toFixed(2), available: available.toFixed(2), requested: amount.toFixed(2), ok: !!budget && available.gte(amount), hasBudget: !!budget };
  }
  return { scope: "Sem referência orçamentária", budget: "0.00", used: "0.00", available: "0.00", requested: amount.toFixed(2), ok: false, hasBudget: false };
}

export async function createRequisition(ctx: Ctx, i: RequisitionInput) {
  requirePerm(ctx, "purchase.request");
  requireWritable(ctx);
  const lines = i.lineDescription.map((d, idx) => ({ kind: i.lineKind[idx] || "SERVICE", description: d.trim(), quantity: qty(n(i.lineQuantity[idx]) || "1"), unit: i.lineUnit[idx] || "UN", estimatedUnitPrice: rate(n(i.linePrice[idx])) })).filter((l) => l.description);
  if (!lines.length) throw validation("Informe ao menos um item.");
  if (lines.some((l) => !KINDS.includes(l.kind as (typeof KINDS)[number]) || l.quantity.lte(0) || l.estimatedUnitPrice.lt(0))) throw validation("Itens inválidos (tipo, quantidade ou preço).");
  if (!i.projectId && !i.costCenterId) throw validation("Informe o projeto ou o centro de custo (apropriação).");
  if (i.projectId) {
    const p = await ctx.db.project.findFirst({ where: { id: i.projectId } });
    if (!p) throw validation("Projeto inválido.");
    if (p.companyId !== i.companyId) throw validation("Projeto de outra empresa.");
  }
  const estimated = money(sum(lines.map((l) => l.quantity.times(l.estimatedUnitPrice))));
  const check = await budgetCheck(ctx, { ...i, amount: estimated.toString() });
  return ctx.db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "REQUISITION");
    const r = await tx.purchaseRequisition.create({ data: { organizationId: ctx.orgId, companyId: i.companyId, number, requesterId: ctx.userId, costCenterId: i.costCenterId ?? null, projectId: i.projectId ?? null, accountId: i.accountId ?? null, description: i.description, justification: i.justification ?? null, neededBy: i.neededBy ? civil(i.neededBy) : null, estimatedAmount: estimated, budgetCheck: check } });
    await tx.requisitionLine.createMany({ data: lines.map((l) => ({ organizationId: ctx.orgId, requisitionId: r.id, ...l })) });
    await audit(ctx, { action: "requisition.create", entity: "PurchaseRequisition", entityId: r.id, companyId: i.companyId, changes: { estimated: estimated.toString(), budget: check } }, tx);
    return r;
  });
}

export async function submitRequisition(ctx: Ctx, id: string) {
  requirePerm(ctx, "purchase.request");
  requireWritable(ctx);
  return ctx.db.$transaction(async (tx) => {
    const r = await tx.purchaseRequisition.findFirst({ where: { id } });
    if (!r || r.status !== "DRAFT") throw rule("Requisição não está em rascunho.");
    const { approved } = await openApprovals(ctx, tx, { docType: "REQUISITION", entity: "PurchaseRequisition", entityId: id, facts: { companyId: r.companyId, amount: r.estimatedAmount } });
    await tx.purchaseRequisition.update({ where: { id }, data: { status: approved ? "APPROVED" : "SUBMITTED" } });
    await audit(ctx, { action: "requisition.submit", entity: "PurchaseRequisition", entityId: id, changes: { autoApproved: approved } }, tx);
    return approved;
  });
}

registerApprovalHandler("PurchaseRequisition", {
  label: "Requisição de compra",
  link: (id) => `/app/suprimentos/requisicoes/${id}`,
  onApproved: async (ctx, tx, id) => { await tx.purchaseRequisition.update({ where: { id }, data: { status: "APPROVED" } }); },
  onRejected: async (ctx, tx, id, comment) => { await tx.purchaseRequisition.update({ where: { id }, data: { status: "REJECTED" } }); await audit(ctx, { action: "requisition.rejected", entity: "PurchaseRequisition", entityId: id, reason: comment }, tx); },
});

// ------------------------------------------------------------------ Cotações e mapa comparativo
export const quotationSchema = z.object({ requisitionId: z.string(), supplierPartyId: z.string().min(1), deliveryDays: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(0).optional()), paymentTerms: zOptStr, validUntil: zOptDate, notes: zOptStr, lineId: z.preprocess(arr, z.array(z.string())), unitPrice: z.preprocess(arr, z.array(z.string())) });
export async function addQuotation(ctx: Ctx, i: z.infer<typeof quotationSchema>) {
  requirePerm(ctx, "purchase.write");
  requireWritable(ctx);
  const r = await ctx.db.purchaseRequisition.findFirst({ where: { id: i.requisitionId } });
  if (!r || !["APPROVED", "QUOTING"].includes(r.status)) throw rule("Requisição precisa estar aprovada para receber cotações.");
  const sup = await ctx.db.party.findFirst({ where: { id: i.supplierPartyId, isSupplier: true, active: true } });
  if (!sup) throw validation("Fornecedor inválido.");
  if (await ctx.db.quotation.findFirst({ where: { requisitionId: r.id, supplierPartyId: sup.id } })) throw conflict("Este fornecedor já cotou esta requisição.");
  const lines = await ctx.db.requisitionLine.findMany({ where: { requisitionId: r.id } });
  const prices = lines.map((l) => {
    const idx = i.lineId.indexOf(l.id);
    const p = rate(n(i.unitPrice[idx]));
    if (idx < 0 || p.lte(0)) throw validation(`Informe o preço do item "${l.description}".`);
    return { line: l, unitPrice: p, amount: money(p.times(dec(l.quantity))) };
  });
  const total = money(sum(prices.map((p) => p.amount)));
  return ctx.db.$transaction(async (tx) => {
    const q = await tx.quotation.create({ data: { organizationId: ctx.orgId, requisitionId: r.id, supplierPartyId: sup.id, totalAmount: total, deliveryDays: i.deliveryDays ?? null, paymentTerms: i.paymentTerms ?? null, validUntil: i.validUntil ? civil(i.validUntil) : null, notes: i.notes ?? null } });
    await tx.quotationLine.createMany({ data: prices.map((p) => ({ organizationId: ctx.orgId, quotationId: q.id, requisitionLineId: p.line.id, unitPrice: p.unitPrice, amount: p.amount })) });
    if (r.status === "APPROVED") await tx.purchaseRequisition.update({ where: { id: r.id }, data: { status: "QUOTING" } });
    await audit(ctx, { action: "quotation.create", entity: "PurchaseRequisition", entityId: r.id, changes: { supplier: sup.name, total: total.toString() } }, tx);
    return q;
  });
}

// ------------------------------------------------------------------ Pedido de compra / contratação
export const poSchema = z.object({
  companyId: z.string().min(1), supplierPartyId: z.string().min(1), requisitionId: zOptId, quotationId: zOptId, projectId: zOptId, costCenterId: zOptId, accountId: zOptId,
  kind: z.enum(["ONE_OFF", "SUBCONTRACT", "PJ_PROFESSIONAL", "RECURRING", "LICENSE"]).default("ONE_OFF"), orderDate: zDate, startDate: zOptDate, endDate: zOptDate, paymentTermId: zOptId,
  advanceAmount: zDecimal, tolerancePct: zDecimal, notes: zOptStr,
  lineKind: z.preprocess(arr, z.array(z.string())), lineDescription: z.preprocess(arr, z.array(z.string())), lineQuantity: z.preprocess(arr, z.array(z.string())), linePrice: z.preprocess(arr, z.array(z.string())),
});
export type PoInput = z.infer<typeof poSchema>;

export async function createPurchaseOrder(ctx: Ctx, i: PoInput) {
  requirePerm(ctx, "purchase.write");
  requireWritable(ctx);
  const sup = await ctx.db.party.findFirst({ where: { id: i.supplierPartyId, isSupplier: true } });
  if (!sup || !sup.active) throw validation("Fornecedor inválido ou inativo.");
  let lines = i.lineDescription.map((d, idx) => ({ kind: i.lineKind[idx] || "SERVICE", description: d.trim(), quantity: qty(n(i.lineQuantity[idx]) || "1"), unitPrice: rate(n(i.linePrice[idx])) })).filter((l) => l.description);
  let requisition = null;
  if (i.quotationId) {
    const q = await ctx.db.quotation.findFirst({ where: { id: i.quotationId } });
    if (!q || q.supplierPartyId !== sup.id) throw validation("Cotação inválida para este fornecedor.");
    requisition = await ctx.db.purchaseRequisition.findFirstOrThrow({ where: { id: q.requisitionId } });
    if (await ctx.db.purchaseOrder.findFirst({ where: { requisitionId: requisition.id, status: { not: "CANCELED" } } })) throw conflict("Requisição já possui pedido de compra.");
    const qlines = await ctx.db.quotationLine.findMany({ where: { quotationId: q.id } });
    const rlines = await ctx.db.requisitionLine.findMany({ where: { requisitionId: requisition.id } });
    lines = qlines.map((ql) => { const rl = rlines.find((x) => x.id === ql.requisitionLineId)!; return { kind: rl.kind, description: rl.description, quantity: qty(rl.quantity), unitPrice: rate(ql.unitPrice) }; });
  }
  if (!lines.length) throw validation("Informe ao menos um item.");
  if (lines.some((l) => l.quantity.lte(0) || l.unitPrice.lte(0))) throw validation("Quantidade e preço devem ser maiores que zero.");
  const total = money(sum(lines.map((l) => l.quantity.times(l.unitPrice))));
  if (money(i.advanceAmount).gt(total)) throw validation("Adiantamento maior que o pedido.");
  const projectId = i.projectId ?? requisition?.projectId ?? null;
  const costCenterId = i.costCenterId ?? requisition?.costCenterId ?? null;
  if (!projectId && !costCenterId) throw validation("Informe projeto ou centro de custo.");
  if (i.kind === "RECURRING" && (!i.startDate || !i.endDate)) throw validation("Compra recorrente exige vigência (início e fim).");
  return ctx.db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "PURCHASE_ORDER");
    const po = await tx.purchaseOrder.create({
      data: {
        organizationId: ctx.orgId, companyId: i.companyId, number, supplierPartyId: sup.id, requisitionId: requisition?.id ?? i.requisitionId ?? null, quotationId: i.quotationId ?? null, projectId, costCenterId, accountId: i.accountId ?? requisition?.accountId ?? null,
        kind: i.kind, orderDate: civil(i.orderDate), startDate: i.startDate ? civil(i.startDate) : null, endDate: i.endDate ? civil(i.endDate) : null, paymentTermId: i.paymentTermId ?? null,
        totalAmount: total, advanceAmount: money(i.advanceAmount), tolerancePct: dec(i.tolerancePct), notes: i.notes ?? null, createdById: ctx.userId,
      },
    });
    await tx.purchaseOrderLine.createMany({ data: lines.map((l) => ({ organizationId: ctx.orgId, purchaseOrderId: po.id, kind: l.kind, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, amount: money(l.quantity.times(l.unitPrice)) })) });
    if (i.quotationId) await tx.quotation.update({ where: { id: i.quotationId }, data: { selected: true } });
    if (requisition) await tx.purchaseRequisition.update({ where: { id: requisition.id }, data: { status: "ORDERED" } });
    await audit(ctx, { action: "po.create", entity: "PurchaseOrder", entityId: po.id, companyId: i.companyId, changes: { supplier: sup.name, total: total.toString(), kind: i.kind } }, tx);
    return po;
  });
}

export async function submitPurchaseOrder(ctx: Ctx, id: string) {
  requirePerm(ctx, "purchase.write");
  requireWritable(ctx);
  const r = await ctx.db.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({ where: { id } });
    if (!po || po.status !== "DRAFT") throw rule("Pedido não está em rascunho.");
    const check = await budgetCheck(ctx, { projectId: po.projectId, costCenterId: po.costCenterId, accountId: po.accountId, companyId: po.companyId, amount: po.totalAmount.toString(), exceptPoId: po.id });
    const { approved, matched } = await openApprovals(ctx, tx, { docType: "PURCHASE_ORDER", entity: "PurchaseOrder", entityId: id, facts: { companyId: po.companyId, amount: po.totalAmount } });
    await tx.purchaseOrder.update({ where: { id }, data: { status: approved ? "APPROVED" : "PENDING_APPROVAL" } });
    if (approved) await onPoApproved(ctx, tx, id);
    await audit(ctx, { action: "po.submit", entity: "PurchaseOrder", entityId: id, changes: { budget: check } }, tx);
    return { approved, matched, check };
  });
  if (!r.approved) await notify(ctx.orgId, await usersWithPermission(ctx.orgId, "purchase.approve"), { title: "Pedido de compra aguardando aprovação", body: r.check.ok ? undefined : "Atenção: acima do orçamento disponível", link: `/app/suprimentos/pedidos/${id}` });
  return r;
}

async function onPoApproved(ctx: Ctx, tx: TenantTx, id: string) {
  const po = await tx.purchaseOrder.findFirstOrThrow({ where: { id } });
  await tx.purchaseOrder.update({ where: { id }, data: { status: "APPROVED", approvedById: ctx.userId, approvedAt: new Date() } });
  // Adiantamento ao fornecedor: conta a pagar própria (aplicada às NFs futuras)
  if (dec(po.advanceAmount).gt(0)) {
    const number = await nextNumber(tx, ctx.orgId, "PAYABLE");
    const today = todayIn(ctx.timezone);
    await tx.payable.create({ data: { organizationId: ctx.orgId, companyId: po.companyId, number, partyId: po.supplierPartyId, sourceType: "SUPPLIER_ADVANCE", sourceId: po.id, projectId: po.projectId, costCenterId: po.costCenterId, accountId: po.accountId, issueDate: civil(today), dueDate: civil(addDays(today, 3)), competence: civil(monthStart(today)), amount: po.advanceAmount, openAmount: po.advanceAmount, status: "OPEN", description: `Adiantamento do pedido ${po.number}`, approvedById: ctx.userId, approvedAt: new Date(), createdById: ctx.userId } });
  }
  await audit(ctx, { action: "po.approved", entity: "PurchaseOrder", entityId: id, companyId: po.companyId }, tx);
}

registerApprovalHandler("PurchaseOrder", {
  label: "Pedido de compra",
  link: (id) => `/app/suprimentos/pedidos/${id}`,
  onApproved: onPoApproved,
  onRejected: async (ctx, tx, id, comment) => { await tx.purchaseOrder.update({ where: { id }, data: { status: "DRAFT" } }); await audit(ctx, { action: "po.rejected", entity: "PurchaseOrder", entityId: id, reason: comment }, tx); },
});

export async function cancelPurchaseOrder(ctx: Ctx, id: string, reason: string) {
  requirePerm(ctx, "purchase.write");
  requireWritable(ctx);
  if (!reason.trim()) throw validation("Informe o motivo.");
  const po = await ctx.db.purchaseOrder.findFirst({ where: { id } });
  if (!po) throw notFound("Pedido");
  const [receipts, invoices] = await Promise.all([ctx.db.goodsReceipt.count({ where: { purchaseOrderId: id, status: "POSTED" } }), ctx.db.supplierInvoice.count({ where: { purchaseOrderId: id, status: { not: "CANCELED" } } })]);
  if (receipts || invoices) throw rule("Pedido com recebimentos ou documentos do fornecedor não pode ser cancelado; encerre o saldo.");
  await ctx.db.purchaseOrder.update({ where: { id }, data: { status: "CANCELED" } });
  await audit(ctx, { action: "po.cancel", entity: "PurchaseOrder", entityId: id, reason });
}

/** Encerra o saldo não recebido do pedido (libera compromisso). */
export async function closePurchaseOrder(ctx: Ctx, id: string, reason: string) {
  requirePerm(ctx, "purchase.write");
  const po = await ctx.db.purchaseOrder.findFirst({ where: { id } });
  if (!po || !["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(po.status)) throw rule("Pedido não pode ser encerrado.");
  await ctx.db.purchaseOrder.update({ where: { id }, data: { status: "CLOSED" } });
  await audit(ctx, { action: "po.close", entity: "PurchaseOrder", entityId: id, reason });
}

// ------------------------------------------------------------------ Recebimento / aceite / devolução
export const receiptSchema = z.object({ purchaseOrderId: z.string(), date: zDate, kind: z.enum(["SERVICE_ACCEPTANCE", "GOODS_RECEIPT", "RETURN"]).default("SERVICE_ACCEPTANCE"), notes: zOptStr, lineId: z.preprocess(arr, z.array(z.string())), quantity: z.preprocess(arr, z.array(z.string())) });
export async function postReceipt(ctx: Ctx, i: z.infer<typeof receiptSchema>) {
  requirePerm(ctx, "purchase.receive");
  requireWritable(ctx);
  return ctx.db.$transaction(async (tx) => {
    const locked = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "PurchaseOrder" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`, i.purchaseOrderId, ctx.orgId);
    if (!locked.length) throw notFound("Pedido");
    const po = await tx.purchaseOrder.findFirstOrThrow({ where: { id: i.purchaseOrderId } });
    if (!["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(po.status)) throw rule("Pedido precisa estar aprovado para receber/aceitar.");
    await assertPeriodOpen(tx, po.companyId, i.date, "Recebimento");
    const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
    const sign = i.kind === "RETURN" ? -1 : 1;
    const items = i.lineId.map((lid, idx) => ({ line: lines.find((l) => l.id === lid), q: qty(n(i.quantity[idx])) })).filter((x) => x.line && x.q.gt(0));
    if (!items.length) throw validation("Informe as quantidades recebidas/aceitas.");
    for (const it of items) {
      const l = it.line!;
      const remaining = dec(l.quantity).minus(dec(l.receivedQty));
      const tolQ = dec(l.quantity).times(dec(po.tolerancePct)).div(100);
      if (sign > 0 && it.q.gt(remaining.plus(tolQ))) throw rule(`Quantidade acima do saldo do item "${l.description}" (saldo ${remaining}).`);
      if (sign < 0 && it.q.gt(dec(l.receivedQty).minus(dec(l.invoicedAmount).div(dec(l.unitPrice))))) throw rule(`Devolução acima do recebido não faturado em "${l.description}".`);
    }
    const number = await nextNumber(tx, ctx.orgId, "GOODS_RECEIPT");
    const rc = await tx.goodsReceipt.create({ data: { organizationId: ctx.orgId, companyId: po.companyId, purchaseOrderId: po.id, number, date: civil(i.date), kind: i.kind, notes: i.notes ?? null, acceptedById: ctx.userId } });
    for (const it of items) {
      const l = it.line!;
      const amount = money(it.q.times(dec(l.unitPrice)));
      await tx.goodsReceiptLine.create({ data: { organizationId: ctx.orgId, receiptId: rc.id, poLineId: l.id, quantity: it.q.times(sign), amount: amount.times(sign) } });
      await tx.purchaseOrderLine.update({ where: { id: l.id }, data: { receivedQty: dec(l.receivedQty).plus(it.q.times(sign)), receivedAmount: dec(l.receivedAmount).plus(amount.times(sign)) } });
    }
    const after = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
    const full = after.every((l) => dec(l.receivedQty).gte(dec(l.quantity)));
    const none = after.every((l) => dec(l.receivedQty).lte(0));
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: full ? "RECEIVED" : none ? "APPROVED" : "PARTIALLY_RECEIVED" } });
    // Equipamentos e licenças recebidos entram no controle de ativos
    if (sign > 0) for (const it of items.filter((x) => ["EQUIPMENT", "LICENSE", "SUBSCRIPTION", "MATERIAL"].includes(x.line!.kind))) {
      await tx.asset.create({ data: { organizationId: ctx.orgId, companyId: po.companyId, kind: it.line!.kind === "SUBSCRIPTION" ? "SUBSCRIPTION" : it.line!.kind, name: it.line!.description, supplierPartyId: po.supplierPartyId, purchaseOrderId: po.id, projectId: po.projectId, quantity: it.q, cost: money(it.q.times(dec(it.line!.unitPrice))), acquiredAt: civil(i.date), renewalDate: ["LICENSE", "SUBSCRIPTION"].includes(it.line!.kind) ? po.endDate : null, status: "IN_STOCK" } });
    }
    await audit(ctx, { action: i.kind === "RETURN" ? "receipt.return" : "receipt.post", entity: "PurchaseOrder", entityId: po.id, companyId: po.companyId, changes: { receipt: number, items: items.length } }, tx);
    return rc;
  });
}

// ------------------------------------------------------------------ Documento do fornecedor (NF/fatura)
export const supplierInvoiceSchema = z.object({ purchaseOrderId: z.string().min(1), number: zStr(1), issueDate: zDate, dueDate: zDate, competence: zDate, amount: zDecimal });
/**
 * Registra o documento de cobrança do fornecedor e executa a conferência de 3 vias.
 * Conferido → aprovado e conta a pagar criada (aguardando aprovação financeira). Divergente → exige tratamento.
 */
export async function registerSupplierInvoice(ctx: Ctx, i: z.infer<typeof supplierInvoiceSchema>) {
  requireAnyPerm(ctx, "purchase.write", "finance.write");
  requireWritable(ctx);
  return ctx.db.$transaction(async (tx) => {
    const locked = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "PurchaseOrder" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`, i.purchaseOrderId, ctx.orgId);
    if (!locked.length) throw notFound("Pedido");
    const po = await tx.purchaseOrder.findFirstOrThrow({ where: { id: i.purchaseOrderId } });
    await assertPeriodOpen(tx, po.companyId, i.competence, "Documento de fornecedor");
    if (await tx.supplierInvoice.findFirst({ where: { supplierPartyId: po.supplierPartyId, number: i.number } })) throw conflict("Documento já registrado para este fornecedor (número duplicado).");
    const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
    const received = sum(lines.map((l) => l.receivedAmount));
    const invoiced = sum(lines.map((l) => l.invoicedAmount));
    const m = threeWayMatch({ poTotal: po.totalAmount, received, alreadyInvoiced: invoiced, invoiceAmount: i.amount, tolerancePct: po.tolerancePct });
    const inv = await tx.supplierInvoice.create({
      data: { organizationId: ctx.orgId, companyId: po.companyId, supplierPartyId: po.supplierPartyId, purchaseOrderId: po.id, number: i.number, issueDate: civil(i.issueDate), dueDate: civil(i.dueDate), competence: civil(monthStart(i.competence)), amount: money(i.amount), status: m.ok ? "RECEIVED" : "DIVERGENT", matchResult: m as object, divergenceNote: m.ok ? null : m.divergences.join(" "), createdById: ctx.userId },
    });
    if (m.ok) await approveInvoiceInternal(ctx, tx, inv.id, null);
    await audit(ctx, { action: m.ok ? "supplier_invoice.matched" : "supplier_invoice.divergent", entity: "SupplierInvoice", entityId: inv.id, companyId: po.companyId, changes: m }, tx);
    return { invoice: inv, match: m };
  });
}

/** Aceite de divergência: exige alçada de compras e justificativa (auditada). */
export async function acceptDivergence(ctx: Ctx, invoiceId: string, reason: string) {
  requirePerm(ctx, "purchase.approve");
  requireWritable(ctx);
  if (!reason.trim()) throw validation("Justifique a aceitação da divergência.");
  return ctx.db.$transaction(async (tx) => {
    const inv = await tx.supplierInvoice.findFirst({ where: { id: invoiceId } });
    if (!inv || inv.status !== "DIVERGENT") throw rule("Documento não está divergente.");
    const po = await tx.purchaseOrder.findFirstOrThrow({ where: { id: inv.purchaseOrderId! } });
    if (po.createdById === ctx.userId) throw forbidden("Segregação de funções: quem emitiu o pedido não aceita divergência.");
    await approveInvoiceInternal(ctx, tx, invoiceId, reason);
    await audit(ctx, { action: "supplier_invoice.divergence_accepted", entity: "SupplierInvoice", entityId: invoiceId, reason }, tx);
  });
}

async function approveInvoiceInternal(ctx: Ctx, tx: TenantTx, invoiceId: string, reason: string | null) {
  const inv = await tx.supplierInvoice.findFirstOrThrow({ where: { id: invoiceId } });
  const po = await tx.purchaseOrder.findFirstOrThrow({ where: { id: inv.purchaseOrderId! } });
  // Distribui o valor faturado pelas linhas (ordem dos itens, até o recebido)
  let rest = dec(inv.amount);
  const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
  for (const [idx, l] of lines.entries()) {
    const room = dec(l.receivedAmount).minus(dec(l.invoicedAmount));
    const take = idx === lines.length - 1 ? rest : Decimal_min(rest, room.gt(0) ? room : dec(0));
    if (take.isZero()) continue;
    await tx.purchaseOrderLine.update({ where: { id: l.id }, data: { invoicedAmount: money(dec(l.invoicedAmount).plus(take)) } });
    rest = rest.minus(take);
  }
  await tx.supplierInvoice.update({ where: { id: invoiceId }, data: { status: "APPROVED", approvedById: ctx.userId, divergenceNote: reason ? `${inv.divergenceNote ?? ""} | Aceita: ${reason}` : inv.divergenceNote } });
  const number = await nextNumber(tx, ctx.orgId, "PAYABLE");
  await tx.payable.create({
    data: {
      organizationId: ctx.orgId, companyId: po.companyId, number, partyId: po.supplierPartyId, sourceType: "SUPPLIER_INVOICE", sourceId: inv.id, projectId: po.projectId, costCenterId: po.costCenterId, accountId: po.accountId,
      issueDate: inv.issueDate, dueDate: inv.dueDate, competence: inv.competence, amount: inv.amount, openAmount: inv.amount, status: "PENDING_APPROVAL", description: `NF ${inv.number} — pedido ${po.number}`, createdById: ctx.userId,
    },
  });
}
function Decimal_min(a: ReturnType<typeof dec>, b: ReturnType<typeof dec>) {
  return a.lt(b) ? a : b;
}

export async function cancelSupplierInvoice(ctx: Ctx, id: string, reason: string) {
  requireAnyPerm(ctx, "purchase.write", "finance.write");
  if (!reason.trim()) throw validation("Informe o motivo.");
  return ctx.db.$transaction(async (tx) => {
    const inv = await tx.supplierInvoice.findFirst({ where: { id } });
    if (!inv || inv.status === "CANCELED") throw notFound("Documento");
    const pay = await tx.payable.findFirst({ where: { sourceType: "SUPPLIER_INVOICE", sourceId: id } });
    if (pay && !["PENDING_APPROVAL", "OPEN"].includes(pay.status)) throw rule("Conta a pagar já liquidada (total ou parcial): estorne o pagamento antes.");
    if (pay && dec(pay.openAmount).lt(dec(pay.amount))) throw rule("Há liquidação parcial: estorne antes de cancelar.");
    if (pay) await tx.payable.update({ where: { id: pay.id }, data: { status: "CANCELED", openAmount: 0 } });
    if (inv.status === "APPROVED") {
      let rest = dec(inv.amount);
      for (const l of (await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: inv.purchaseOrderId! } })).reverse()) {
        const take = Decimal_min(rest, dec(l.invoicedAmount));
        if (take.isZero()) continue;
        await tx.purchaseOrderLine.update({ where: { id: l.id }, data: { invoicedAmount: money(dec(l.invoicedAmount).minus(take)) } });
        rest = rest.minus(take);
      }
    }
    await tx.supplierInvoice.update({ where: { id }, data: { status: "CANCELED" } });
    await audit(ctx, { action: "supplier_invoice.cancel", entity: "SupplierInvoice", entityId: id, reason }, tx);
  });
}

// ------------------------------------------------------------------ Avaliação, documentação, ativos
export const evaluationSchema = z.object({ partyId: z.string(), purchaseOrderId: zOptId, quality: z.coerce.number().int().min(1).max(5), deadline: z.coerce.number().int().min(1).max(5), price: z.coerce.number().int().min(1).max(5), communication: z.coerce.number().int().min(1).max(5), comment: zOptStr });
export async function evaluateSupplier(ctx: Ctx, i: z.infer<typeof evaluationSchema>) {
  requireAnyPerm(ctx, "purchase.write", "purchase.receive");
  const e = await ctx.db.supplierEvaluation.create({ data: { organizationId: ctx.orgId, ...i, purchaseOrderId: i.purchaseOrderId ?? null, comment: i.comment ?? null, createdById: ctx.userId } });
  await audit(ctx, { action: "supplier.evaluate", entity: "Party", entityId: i.partyId, changes: i });
  return e;
}

export const complianceSchema = z.object({ partyId: z.string(), docType: zStr(2), validUntil: zOptDate, notes: zOptStr });
export async function addComplianceDoc(ctx: Ctx, i: z.infer<typeof complianceSchema>) {
  requireAnyPerm(ctx, "purchase.write", "master.write");
  const d = await ctx.db.supplierComplianceDoc.create({ data: { organizationId: ctx.orgId, partyId: i.partyId, docType: i.docType, validUntil: i.validUntil ? civil(i.validUntil) : null, notes: i.notes ?? null } });
  await audit(ctx, { action: "supplier.compliance_doc", entity: "Party", entityId: i.partyId, changes: i });
  return d;
}

export const assetMoveSchema = z.object({ assetId: z.string(), kind: z.enum(["ASSIGN", "RETURN", "RETIRE"]), professionalId: zOptId, notes: zOptStr });
export async function moveAsset(ctx: Ctx, i: z.infer<typeof assetMoveSchema>) {
  requireAnyPerm(ctx, "purchase.write", "purchase.receive");
  requireWritable(ctx);
  const a = await ctx.db.asset.findFirst({ where: { id: i.assetId } });
  if (!a) throw notFound("Ativo");
  if (i.kind === "ASSIGN" && !i.professionalId) throw validation("Informe o profissional.");
  if (i.kind === "ASSIGN" && a.status === "ASSIGNED") throw rule("Ativo já atribuído; registre a devolução antes.");
  if (a.status === "RETIRED") throw rule("Ativo baixado.");
  await ctx.db.assetMovement.create({ data: { organizationId: ctx.orgId, assetId: a.id, kind: i.kind, professionalId: i.professionalId ?? null, notes: i.notes ?? null, createdById: ctx.userId } });
  await ctx.db.asset.update({ where: { id: a.id }, data: { status: i.kind === "ASSIGN" ? "ASSIGNED" : i.kind === "RETURN" ? "IN_STOCK" : "RETIRED", assignedProfessionalId: i.kind === "ASSIGN" ? i.professionalId : null } });
  await audit(ctx, { action: `asset.${i.kind.toLowerCase()}`, entity: "Asset", entityId: a.id, changes: i });
}

/** Compromissos financeiros ainda não faturados (para previsão de caixa e P&L). */
export async function openCommitments(ctx: Ctx, filter: { projectId?: string; supplierPartyId?: string } = {}) {
  const pos = await ctx.db.purchaseOrder.findMany({ where: { status: { in: ["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED"] }, ...filter } });
  const lines = await ctx.db.purchaseOrderLine.findMany({ where: { purchaseOrderId: { in: pos.map((p) => p.id) } } });
  return pos.map((po) => {
    const ls = lines.filter((l) => l.purchaseOrderId === po.id);
    const invoiced = sum(ls.map((l) => l.invoicedAmount));
    return { po, invoiced: money(invoiced), open: money(dec(po.totalAmount).minus(invoiced)), received: money(sum(ls.map((l) => l.receivedAmount))) };
  }).filter((x) => x.open.gt(0));
}

export function toCivilOrNull(d: Date | null) {
  return d ? toCivil(d) : null;
}
