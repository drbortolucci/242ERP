/**
 * Pedido de venda de produtos:
 *   rascunho → confirmado (reserva o disponível no depósito) → entregue (baixa ao custo médio, títulos a receber pela
 *   condição de pagamento, receita e custo das mercadorias no razão gerencial) → cancelado (estorna a baixa e cancela
 *   os títulos ainda sem liquidação).
 * O pedido é documento interno: a nota fiscal de mercadorias é emitida pelo módulo fiscal/provedor homologado.
 */
import { z } from "zod";
import { requirePerm, requireWritable, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { nextNumber } from "@/server/sequences";
import { assertPeriodOpen } from "@/server/periods";
import { getSetting } from "@/server/settings";
import { conflict, notFound, rule, validation } from "@/lib/errors";
import { zArray, zDate, zDecimal, zOptId, zOptStr } from "@/lib/zod-helpers";
import { civil, toCivil } from "@/lib/dates";
import { dec, money, sum } from "@/lib/money";
import { qty4 } from "@/domain/stock";
import { receivableInstallments } from "@/domain/billing";
import type { TenantTx } from "@/server/tenant-db";
import { postMovement, reverseMovement } from "./stock";

const n = (s: string | undefined) => { const v = (s ?? "").trim(); return v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v || "0"; };

export const productOrderSchema = z.object({
  id: zOptId, companyId: z.string().min(1), partyId: z.string().min(1), warehouseId: z.string().min(1), orderDate: zDate, paymentTermId: zOptId,
  freightAmount: zDecimal, customerPo: zOptStr, notes: zOptStr,
  lineProduct: zArray, lineQuantity: zArray, linePrice: zArray, lineDiscount: zArray,
});

async function lockOrder(tx: TenantTx, ctx: Ctx, id: string) {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "ProductOrder" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`, id, ctx.orgId);
  if (!rows.length) throw notFound("Pedido");
  return tx.productOrder.findFirstOrThrow({ where: { id } });
}

export async function saveProductOrder(ctx: Ctx, i: z.infer<typeof productOrderSchema>) {
  requirePerm(ctx, "sales.goods");
  requireWritable(ctx);
  const [party, wh] = await Promise.all([ctx.db.party.findFirst({ where: { id: i.partyId } }), ctx.db.warehouse.findFirst({ where: { id: i.warehouseId } })]);
  if (!party || !party.active || !party.isCustomer) throw validation("Cliente inválido ou inativo.");
  if (!wh || !wh.active) throw validation("Depósito inválido ou inativo.");
  if (wh.companyId !== i.companyId) throw validation("O depósito pertence a outra empresa.");
  const products = await ctx.db.product.findMany({ where: { id: { in: i.lineProduct.filter(Boolean) } } });
  const lines = i.lineProduct.map((pid, idx) => ({ pid, quantity: qty4(n(i.lineQuantity[idx])), unitPrice: dec(n(i.linePrice[idx])), discount: money(n(i.lineDiscount[idx])) })).filter((l) => l.pid);
  if (!lines.length) throw validation("Informe ao menos um item.");
  const rows = lines.map((l) => {
    const p = products.find((x) => x.id === l.pid);
    if (!p || !p.active) throw validation("Produto inválido ou inativo.");
    if (l.quantity.lte(0) || l.unitPrice.lt(0) || l.discount.lt(0)) throw validation(`Quantidade, preço ou desconto inválido em ${p.code}.`);
    const gross = money(l.quantity.times(l.unitPrice));
    if (l.discount.gt(gross)) throw validation(`Desconto maior que o valor do item ${p.code}.`);
    return { productId: p.id, description: `${p.code} — ${p.name}`, quantity: l.quantity, unitPrice: l.unitPrice.toDecimalPlaces(4), discountAmount: l.discount, amount: money(gross.minus(l.discount)), gross };
  });
  const productsAmount = money(sum(rows.map((r) => r.gross)));
  const discountAmount = money(sum(rows.map((r) => r.discountAmount)));
  const freight = money(n(i.freightAmount));
  if (freight.lt(0)) throw validation("Frete não pode ser negativo.");
  const totalAmount = money(productsAmount.minus(discountAmount).plus(freight));
  if (i.paymentTermId && !(await ctx.db.paymentTerm.findFirst({ where: { id: i.paymentTermId, active: true } }))) throw validation("Condição de pagamento inválida.");
  return ctx.db.$transaction(async (tx) => {
    let order;
    const data = { companyId: i.companyId, partyId: party.id, warehouseId: wh.id, orderDate: civil(i.orderDate), paymentTermId: i.paymentTermId ?? null, productsAmount, discountAmount, freightAmount: freight, totalAmount, customerPo: i.customerPo ?? null, notes: i.notes ?? null };
    if (i.id) {
      const cur = await lockOrder(tx, ctx, i.id);
      if (cur.status !== "DRAFT") throw rule("Somente pedidos em rascunho podem ser alterados.");
      order = await tx.productOrder.update({ where: { id: cur.id }, data });
      await tx.productOrderLine.deleteMany({ where: { orderId: cur.id } });
    } else {
      const number = await nextNumber(tx, ctx.orgId, "PRODUCT_ORDER");
      order = await tx.productOrder.create({ data: { organizationId: ctx.orgId, number, createdById: ctx.userId, ...data } });
    }
    await tx.productOrderLine.createMany({ data: rows.map(({ gross: _g, ...r }) => ({ organizationId: ctx.orgId, orderId: order.id, ...r })) });
    await audit(ctx, { action: i.id ? "product_order.update" : "product_order.create", entity: "ProductOrder", entityId: order.id, companyId: order.companyId, changes: { total: totalAmount.toString(), items: rows.length } }, tx);
    return order;
  });
}

/** Confirma o pedido e reserva as quantidades (exige disponível, salvo depósito que aceita saldo negativo). */
export async function confirmProductOrder(ctx: Ctx, id: string) {
  requirePerm(ctx, "sales.goods");
  requireWritable(ctx);
  return ctx.db.$transaction(async (tx) => {
    const o = await lockOrder(tx, ctx, id);
    if (o.status !== "DRAFT") throw rule("Somente pedidos em rascunho podem ser confirmados.");
    const wh = await tx.warehouse.findFirstOrThrow({ where: { id: o.warehouseId } });
    const lines = await tx.productOrderLine.findMany({ where: { orderId: o.id } });
    const need = new Map<string, ReturnType<typeof dec>>();
    for (const l of lines) need.set(l.productId, (need.get(l.productId) ?? dec(0)).plus(dec(l.quantity)));
    for (const [productId, q] of need) {
      const p = await tx.product.findFirstOrThrow({ where: { id: productId } });
      if (!p.tracksStock) continue;
      const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "StockBalance" WHERE "organizationId" = $1 AND "productId" = $2 AND "warehouseId" = $3 FOR UPDATE`, ctx.orgId, productId, wh.id);
      const b = rows.length ? await tx.stockBalance.findFirstOrThrow({ where: { id: rows[0].id } }) : null;
      const available = b ? dec(b.quantity).minus(dec(b.reserved)) : dec(0);
      if (available.lt(q) && !wh.allowNegative) throw rule(`${p.code}: disponível ${available.toFixed()} ${p.unit}, pedido ${q.toFixed()} ${p.unit}.`);
      if (b) await tx.stockBalance.update({ where: { id: b.id }, data: { reserved: dec(b.reserved).plus(q) } });
    }
    await tx.productOrder.update({ where: { id: o.id }, data: { status: "CONFIRMED" } });
    await audit(ctx, { action: "product_order.confirm", entity: "ProductOrder", entityId: o.id, companyId: o.companyId }, tx);
  });
}

async function releaseReservation(ctx: Ctx, tx: TenantTx, o: { id: string; warehouseId: string }) {
  for (const l of await tx.productOrderLine.findMany({ where: { orderId: o.id } })) {
    const b = await tx.stockBalance.findFirst({ where: { productId: l.productId, warehouseId: o.warehouseId } });
    if (b) await tx.stockBalance.update({ where: { id: b.id }, data: { reserved: dec(b.reserved).minus(dec(l.quantity)).lt(0) ? 0 : dec(b.reserved).minus(dec(l.quantity)) } });
  }
}

export const deliverSchema = z.object({ id: z.string().min(1), date: zDate });
/** Entrega/faturamento interno: baixa de estoque ao custo médio e títulos a receber. */
export async function deliverProductOrder(ctx: Ctx, i: z.infer<typeof deliverSchema>) {
  requirePerm(ctx, "sales.goods");
  requireWritable(ctx);
  const settings = await getSetting(ctx, "billing");
  return ctx.db.$transaction(async (tx) => {
    const o = await lockOrder(tx, ctx, i.id);
    if (o.status !== "CONFIRMED") throw rule("Confirme o pedido antes da entrega.");
    if (i.date < toCivil(o.orderDate)) throw validation("Data de entrega anterior à data do pedido.");
    await assertPeriodOpen(tx, o.companyId, i.date, "Entrega");
    await releaseReservation(ctx, tx, o);
    const lines = await tx.productOrderLine.findMany({ where: { orderId: o.id } });
    let totalCost = dec(0);
    for (const l of lines) {
      const p = await tx.product.findFirstOrThrow({ where: { id: l.productId } });
      if (!p.tracksStock) continue;
      const mv = await postMovement(ctx, tx, { productId: l.productId, warehouseId: o.warehouseId, date: i.date, type: "SALE", direction: "OUT", quantity: dec(l.quantity), sourceType: "SALE_ORDER", sourceId: o.id, partyId: o.partyId, reason: `Pedido ${o.number}`, idempotencyKey: `SALE:${l.id}` });
      const cost = dec(mv.totalCost).negated();
      totalCost = totalCost.plus(cost);
      await tx.productOrderLine.update({ where: { id: l.id }, data: { unitCost: mv.unitCost, costAmount: cost } });
    }
    const term = o.paymentTermId ? await tx.paymentTerm.findFirst({ where: { id: o.paymentTermId } }) : null;
    for (const p of receivableInstallments(o.totalAmount, i.date, term ? (term.installments as { days: number; percent: string }[]) : null, settings.defaultDueDays)) {
      if (dec(p.amount).isZero()) continue;
      const number = await nextNumber(tx, ctx.orgId, "RECEIVABLE");
      await tx.receivable.create({ data: { organizationId: ctx.orgId, companyId: o.companyId, number, partyId: o.partyId, productOrderId: o.id, installment: p.installment, installments: p.installments, issueDate: civil(i.date), dueDate: civil(p.dueDate), competence: civil(i.date), amount: p.amount, openAmount: p.amount, description: `Pedido ${o.number} — parcela ${p.installment}/${p.installments}` } });
    }
    await tx.productOrder.update({ where: { id: o.id }, data: { status: "DELIVERED", deliveredAt: civil(i.date), costAmount: money(totalCost) } });
    await audit(ctx, { action: "product_order.deliver", entity: "ProductOrder", entityId: o.id, companyId: o.companyId, changes: { date: i.date, total: o.totalAmount.toString(), cost: money(totalCost).toString() } }, tx);
  });
}

export async function cancelProductOrder(ctx: Ctx, id: string, reason: string, date: string) {
  requirePerm(ctx, "sales.goods");
  requireWritable(ctx);
  if (reason.trim().length < 3) throw validation("Informe o motivo do cancelamento.");
  return ctx.db.$transaction(async (tx) => {
    const o = await lockOrder(tx, ctx, id);
    if (o.status === "CANCELED") throw conflict("Pedido já cancelado.");
    if (o.status === "CONFIRMED") await releaseReservation(ctx, tx, o);
    if (o.status === "DELIVERED") {
      if (o.fiscalStatus === "AUTHORIZED") throw rule("Pedido com nota fiscal autorizada: cancele a nota (ou registre a devolução) antes.");
      const recs = await tx.receivable.findMany({ where: { productOrderId: o.id, status: { not: "CANCELED" } } });
      if (recs.some((r) => !dec(r.openAmount).eq(dec(r.amount)))) throw rule("Há parcelas com recebimento, crédito ou compensação: estorne-os antes de cancelar.");
      for (const r of recs) await tx.receivable.update({ where: { id: r.id }, data: { status: "CANCELED", openAmount: 0 } });
      const movs = await tx.stockMovement.findMany({ where: { sourceType: "SALE_ORDER", sourceId: o.id, type: "SALE" } });
      for (const m of movs) await reverseMovement(ctx, tx, m.id, date < toCivil(m.date) ? toCivil(m.date) : date, `Cancelamento do pedido ${o.number}: ${reason}`);
    }
    await tx.productOrder.update({ where: { id: o.id }, data: { status: "CANCELED", cancelReason: reason } });
    await audit(ctx, { action: "product_order.cancel", entity: "ProductOrder", entityId: o.id, companyId: o.companyId, changes: { from: o.status, reason } }, tx);
  });
}
