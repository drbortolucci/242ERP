/**
 * Estoque e produtos: cadastro de produtos e depósitos, movimentos manuais (saldo inicial, ajustes, consumo),
 * transferências entre depósitos, inventário (contagem física) e consultas (posição, kardex, reposição).
 * Pedidos de venda de produtos: ver ./orders.ts. Entradas por compra: recebimento do pedido de compra (suprimentos).
 */
import { z } from "zod";
import { requirePerm, requireWritable, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { nextNumber } from "@/server/sequences";
import { conflict, notFound, rule, validation } from "@/lib/errors";
import { zArray, zBool, zDate, zDecimal, zOptDecimal, zOptId, zOptStr, zStr } from "@/lib/zod-helpers";
import { civil, toCivil, todayIn } from "@/lib/dates";
import { dec, money, sum } from "@/lib/money";
import { cost6, countDifference, qty4 } from "@/domain/stock";
import { postMovement, reverseMovement } from "./stock";

const n = (s: string | undefined) => { const v = (s ?? "").trim(); return v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v || "0"; };

// ------------------------------------------------------------------ Produtos
export const productSchema = z.object({
  id: zOptId, code: zStr(1), name: zStr(2), description: zOptStr, categoryId: zOptId,
  kind: z.enum(["GOODS", "MATERIAL", "FINISHED"]).default("GOODS"), unit: zStr(1).default("UN"), barcode: zOptStr, ncm: zOptStr, origin: zOptStr,
  salePrice: zDecimal, minStock: zDecimal, maxStock: zOptDecimal, tracksStock: zBool, revenueAccountId: zOptId, costAccountId: zOptId, active: zBool,
});

export async function saveProduct(ctx: Ctx, i: z.infer<typeof productSchema>) {
  requirePerm(ctx, "inventory.write");
  requireWritable(ctx);
  const code = i.code.trim().toUpperCase();
  if (dec(i.salePrice).lt(0) || dec(i.minStock).lt(0)) throw validation("Preço e estoque mínimo não podem ser negativos.");
  if (i.maxStock && dec(i.maxStock).lt(dec(i.minStock))) throw validation("Estoque máximo menor que o mínimo.");
  if (i.ncm && !/^\d{8}$/.test(i.ncm.replace(/\D/g, ""))) throw validation("NCM deve ter 8 dígitos (informado pela empresa; o sistema não valida a classificação).");
  const dupe = await ctx.db.product.findFirst({ where: { code, ...(i.id ? { NOT: { id: i.id } } : {}) } });
  if (dupe) throw conflict(`Já existe produto com o código ${code}.`);
  const data = {
    code, name: i.name, description: i.description ?? null, categoryId: i.categoryId ?? null, kind: i.kind, unit: i.unit.toUpperCase(), barcode: i.barcode ?? null,
    ncm: i.ncm ? i.ncm.replace(/\D/g, "") : null, origin: i.origin ?? null, salePrice: dec(i.salePrice), minStock: qty4(i.minStock), maxStock: i.maxStock ? qty4(i.maxStock) : null,
    tracksStock: i.tracksStock, revenueAccountId: i.revenueAccountId ?? null, costAccountId: i.costAccountId ?? null, active: i.active,
  };
  if (i.id) {
    const before = await ctx.db.product.findFirst({ where: { id: i.id } });
    if (!before) throw notFound("Produto");
    if (before.tracksStock && !i.tracksStock && (await ctx.db.stockMovement.count({ where: { productId: before.id } }))) throw rule("Produto com movimentos de estoque não pode deixar de controlar estoque.");
    const p = await ctx.db.product.update({ where: { id: i.id }, data });
    await audit(ctx, { action: "product.update", entity: "Product", entityId: p.id, changes: { code, salePrice: i.salePrice, active: i.active } });
    return p;
  }
  const p = await ctx.db.product.create({ data: { organizationId: ctx.orgId, ...data } });
  await audit(ctx, { action: "product.create", entity: "Product", entityId: p.id, changes: { code, name: i.name } });
  return p;
}

export const categorySchema = z.object({ name: zStr(2) });
export async function createCategory(ctx: Ctx, i: z.infer<typeof categorySchema>) {
  requirePerm(ctx, "inventory.write");
  requireWritable(ctx);
  if (await ctx.db.productCategory.findFirst({ where: { name: i.name } })) throw conflict("Categoria já existe.");
  return ctx.db.productCategory.create({ data: { organizationId: ctx.orgId, name: i.name } });
}

// ------------------------------------------------------------------ Depósitos
export const warehouseSchema = z.object({ id: zOptId, companyId: z.string().min(1), code: zStr(1), name: zStr(2), allowNegative: zBool, active: zBool });
export async function saveWarehouse(ctx: Ctx, i: z.infer<typeof warehouseSchema>) {
  requirePerm(ctx, "inventory.write");
  requireWritable(ctx);
  const code = i.code.trim().toUpperCase();
  const dupe = await ctx.db.warehouse.findFirst({ where: { code, ...(i.id ? { NOT: { id: i.id } } : {}) } });
  if (dupe) throw conflict(`Já existe depósito com o código ${code}.`);
  if (i.id) {
    const before = await ctx.db.warehouse.findFirst({ where: { id: i.id } });
    if (!before) throw notFound("Depósito");
    if (before.companyId !== i.companyId && (await ctx.db.stockMovement.count({ where: { warehouseId: before.id } }))) throw rule("Depósito com movimentos não pode mudar de empresa.");
    if (!i.active && (await ctx.db.stockBalance.count({ where: { warehouseId: before.id, quantity: { not: 0 } } }))) throw rule("Depósito com saldo não pode ser desativado: transfira os itens antes.");
    const w = await ctx.db.warehouse.update({ where: { id: i.id }, data: { companyId: i.companyId, code, name: i.name, allowNegative: i.allowNegative, active: i.active } });
    await audit(ctx, { action: "warehouse.update", entity: "Warehouse", entityId: w.id, companyId: w.companyId, changes: { code, allowNegative: i.allowNegative, active: i.active } });
    return w;
  }
  const w = await ctx.db.warehouse.create({ data: { organizationId: ctx.orgId, companyId: i.companyId, code, name: i.name, allowNegative: i.allowNegative, active: i.active } });
  await audit(ctx, { action: "warehouse.create", entity: "Warehouse", entityId: w.id, companyId: w.companyId, changes: { code } });
  return w;
}

// ------------------------------------------------------------------ Movimentos manuais
export const manualMovementSchema = z.object({
  type: z.enum(["OPENING", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "CONSUMPTION"]), productId: z.string().min(1), warehouseId: z.string().min(1), date: zDate,
  quantity: zDecimal, unitCost: zOptDecimal, projectId: zOptId, costCenterId: zOptId, reason: zStr(3, "Informe o motivo"),
});

export async function postManualMovement(ctx: Ctx, i: z.infer<typeof manualMovementSchema>) {
  requirePerm(ctx, "inventory.adjust");
  requireWritable(ctx);
  const q = qty4(n(i.quantity));
  if (q.lte(0)) throw validation("Quantidade deve ser maior que zero.");
  const inbound = i.type === "OPENING" || i.type === "ADJUSTMENT_IN";
  if (i.type === "OPENING" && !i.unitCost) throw validation("Saldo inicial exige custo unitário.");
  if (i.type === "CONSUMPTION" && !i.projectId && !i.costCenterId) throw validation("Consumo exige projeto ou centro de custo (apropriação do custo).");
  if (i.type === "OPENING" && (await ctx.db.stockMovement.count({ where: { productId: i.productId, warehouseId: i.warehouseId } }))) throw rule("Saldo inicial só é aceito antes do primeiro movimento do produto no depósito.");
  return ctx.db.$transaction(async (tx) => {
    const mv = await postMovement(ctx, tx, { productId: i.productId, warehouseId: i.warehouseId, date: i.date, type: i.type, direction: inbound ? "IN" : "OUT", quantity: q, unitCost: i.unitCost ? cost6(n(i.unitCost)) : undefined, projectId: i.projectId ?? null, costCenterId: i.costCenterId ?? null, reason: i.reason, sourceType: "MANUAL" });
    await audit(ctx, { action: "stock.movement", entity: "StockMovement", entityId: mv.id, companyId: mv.companyId, changes: { type: i.type, quantity: mv.quantity.toString(), totalCost: mv.totalCost.toString(), reason: i.reason } }, tx);
    return mv;
  });
}

export async function reverseManualMovement(ctx: Ctx, movementId: string, reason: string) {
  requirePerm(ctx, "inventory.adjust");
  requireWritable(ctx);
  if (reason.trim().length < 3) throw validation("Informe o motivo do estorno.");
  return ctx.db.$transaction(async (tx) => {
    const m = await tx.stockMovement.findFirst({ where: { id: movementId } });
    if (!m) throw notFound("Movimento");
    if (m.sourceType !== "MANUAL") throw rule("Movimentos gerados por compra, venda, transferência ou inventário são estornados pelo documento de origem.");
    const rv = await reverseMovement(ctx, tx, m.id, todayIn(ctx.timezone) < toCivil(m.date) ? toCivil(m.date) : todayIn(ctx.timezone), reason);
    await audit(ctx, { action: "stock.reverse", entity: "StockMovement", entityId: m.id, companyId: m.companyId, changes: { reversal: rv.number, reason } }, tx);
    return rv;
  });
}

// ------------------------------------------------------------------ Transferência
export const transferSchema = z.object({ productId: z.string().min(1), fromWarehouseId: z.string().min(1), toWarehouseId: z.string().min(1), date: zDate, quantity: zDecimal, reason: zOptStr });
export async function transferStock(ctx: Ctx, i: z.infer<typeof transferSchema>) {
  requirePerm(ctx, "inventory.write");
  requireWritable(ctx);
  if (i.fromWarehouseId === i.toWarehouseId) throw validation("Depósitos de origem e destino devem ser diferentes.");
  const q = qty4(n(i.quantity));
  if (q.lte(0)) throw validation("Quantidade deve ser maior que zero.");
  const [from, to] = await Promise.all([ctx.db.warehouse.findFirst({ where: { id: i.fromWarehouseId } }), ctx.db.warehouse.findFirst({ where: { id: i.toWarehouseId } })]);
  if (!from || !to) throw validation("Depósito inválido.");
  if (from.companyId !== to.companyId) throw rule("Transferência entre empresas diferentes exige documento fiscal e é tratada como venda/compra entre as empresas.");
  return ctx.db.$transaction(async (tx) => {
    const ref = await nextNumber(tx, ctx.orgId, "STOCK_TRANSFER");
    const out = await postMovement(ctx, tx, { productId: i.productId, warehouseId: from.id, date: i.date, type: "TRANSFER_OUT", direction: "OUT", quantity: q, sourceType: "TRANSFER", sourceId: ref, reason: i.reason ?? `Transferência ${ref} para ${to.code}` });
    const inn = await postMovement(ctx, tx, { productId: i.productId, warehouseId: to.id, date: i.date, type: "TRANSFER_IN", direction: "IN", quantity: q, unitCost: dec(out.totalCost).negated().div(q), sourceType: "TRANSFER", sourceId: ref, reason: i.reason ?? `Transferência ${ref} de ${from.code}` });
    await audit(ctx, { action: "stock.transfer", entity: "StockMovement", entityId: out.id, companyId: from.companyId, changes: { ref, from: from.code, to: to.code, quantity: q.toString(), cost: inn.totalCost.toString() } }, tx);
    return { ref, out, in: inn };
  });
}

// ------------------------------------------------------------------ Inventário (contagem física)
export const countSchema = z.object({ warehouseId: z.string().min(1), date: zDate, notes: zOptStr, onlyWithBalance: zBool });
export async function openCount(ctx: Ctx, i: z.infer<typeof countSchema>) {
  requirePerm(ctx, "inventory.adjust");
  requireWritable(ctx);
  const wh = await ctx.db.warehouse.findFirst({ where: { id: i.warehouseId, active: true } });
  if (!wh) throw validation("Depósito inválido.");
  if (await ctx.db.inventoryCount.findFirst({ where: { warehouseId: wh.id, status: "OPEN" } })) throw conflict("Já existe inventário aberto para este depósito.");
  const balances = await ctx.db.stockBalance.findMany({ where: { warehouseId: wh.id } });
  const products = await ctx.db.product.findMany({ where: { active: true, tracksStock: true }, orderBy: { code: "asc" } });
  const bal = new Map(balances.map((b) => [b.productId, dec(b.quantity)]));
  const lines = products.filter((p) => !i.onlyWithBalance || !(bal.get(p.id) ?? dec(0)).isZero()).map((p) => ({ productId: p.id, systemQty: bal.get(p.id) ?? dec(0) }));
  if (!lines.length) throw rule("Nenhum produto para contar neste depósito.");
  return ctx.db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "INVENTORY_COUNT");
    const c = await tx.inventoryCount.create({ data: { organizationId: ctx.orgId, companyId: wh.companyId, warehouseId: wh.id, number, date: civil(i.date), notes: i.notes ?? null, createdById: ctx.userId } });
    await tx.inventoryCountLine.createMany({ data: lines.map((l) => ({ organizationId: ctx.orgId, countId: c.id, productId: l.productId, systemQty: l.systemQty })) });
    await audit(ctx, { action: "inventory_count.open", entity: "InventoryCount", entityId: c.id, companyId: wh.companyId, changes: { number, items: lines.length } }, tx);
    return c;
  });
}

export const countEntrySchema = z.object({ countId: z.string().min(1), lineId: zArray, counted: zArray });
export async function saveCountEntries(ctx: Ctx, i: z.infer<typeof countEntrySchema>) {
  requirePerm(ctx, "inventory.adjust");
  requireWritable(ctx);
  const c = await ctx.db.inventoryCount.findFirst({ where: { id: i.countId } });
  if (!c) throw notFound("Inventário");
  if (c.status !== "OPEN") throw rule("Inventário já encerrado.");
  const lines = await ctx.db.inventoryCountLine.findMany({ where: { countId: c.id } });
  let saved = 0;
  await ctx.db.$transaction(async (tx) => {
    for (const [idx, lid] of i.lineId.entries()) {
      const l = lines.find((x) => x.id === lid);
      const raw = (i.counted[idx] ?? "").trim();
      if (!l || raw === "") continue;
      const v = qty4(n(raw));
      if (v.lt(0)) throw validation("Quantidade contada não pode ser negativa.");
      await tx.inventoryCountLine.update({ where: { id: l.id }, data: { countedQty: v } });
      saved++;
    }
  });
  return { saved };
}

/**
 * Encerra o inventário: diferença = contado − saldo no momento do encerramento (o saldo pode ter mudado desde a abertura;
 * movimentos posteriores à data do inventário impedem o encerramento). Itens não contados não geram ajuste.
 */
export async function postCount(ctx: Ctx, countId: string) {
  requirePerm(ctx, "inventory.adjust");
  requireWritable(ctx);
  return ctx.db.$transaction(async (tx) => {
    const c = await tx.inventoryCount.findFirst({ where: { id: countId } });
    if (!c) throw notFound("Inventário");
    if (c.status !== "OPEN") throw rule("Inventário já encerrado.");
    const lines = await tx.inventoryCountLine.findMany({ where: { countId: c.id, countedQty: { not: null } } });
    if (!lines.length) throw rule("Informe ao menos uma quantidade contada.");
    let adjusted = 0;
    const date = toCivil(c.date);
    for (const l of lines) {
      const b = await tx.stockBalance.findFirst({ where: { productId: l.productId, warehouseId: c.warehouseId } });
      const diff = countDifference(b?.quantity ?? 0, l.countedQty!);
      if (diff.isZero()) continue;
      const mv = await postMovement(ctx, tx, { productId: l.productId, warehouseId: c.warehouseId, date, type: "COUNT_ADJUSTMENT", direction: diff.gt(0) ? "IN" : "OUT", quantity: diff.abs(), sourceType: "INVENTORY_COUNT", sourceId: c.id, reason: `Inventário ${c.number}`, idempotencyKey: `COUNT:${l.id}` });
      await tx.inventoryCountLine.update({ where: { id: l.id }, data: { movementId: mv.id } });
      adjusted++;
    }
    await tx.inventoryCount.update({ where: { id: c.id }, data: { status: "POSTED", postedById: ctx.userId, postedAt: new Date() } });
    await audit(ctx, { action: "inventory_count.post", entity: "InventoryCount", entityId: c.id, companyId: c.companyId, changes: { counted: lines.length, adjusted } }, tx);
    return { counted: lines.length, adjusted };
  });
}

export async function cancelCount(ctx: Ctx, countId: string) {
  requirePerm(ctx, "inventory.adjust");
  requireWritable(ctx);
  const c = await ctx.db.inventoryCount.findFirst({ where: { id: countId } });
  if (!c) throw notFound("Inventário");
  if (c.status !== "OPEN") throw rule("Somente inventário aberto pode ser cancelado.");
  await ctx.db.inventoryCount.update({ where: { id: c.id }, data: { status: "CANCELED" } });
  await audit(ctx, { action: "inventory_count.cancel", entity: "InventoryCount", entityId: c.id, companyId: c.companyId });
}

// ------------------------------------------------------------------ Consultas
export async function stockPosition(ctx: Ctx, f: { warehouseId?: string; q?: string; belowMin?: boolean } = {}) {
  requirePerm(ctx, "inventory.read");
  const products = await ctx.db.product.findMany({ where: { tracksStock: true, ...(f.q ? { OR: [{ code: { contains: f.q, mode: "insensitive" } }, { name: { contains: f.q, mode: "insensitive" } }] } : {}) }, orderBy: { code: "asc" } });
  const balances = await ctx.db.stockBalance.findMany({ where: { productId: { in: products.map((p) => p.id) }, ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}) } });
  const rows = products.map((p) => {
    const bs = balances.filter((b) => b.productId === p.id);
    const quantity = qty4(sum(bs.map((b) => b.quantity)));
    const reserved = qty4(sum(bs.map((b) => b.reserved)));
    const value = money(sum(bs.map((b) => b.value)));
    const avgCost = quantity.gt(0) ? cost6(value.div(quantity)) : dec(0);
    return { product: p, quantity, reserved, available: quantity.minus(reserved), value, avgCost, belowMin: quantity.minus(reserved).lt(dec(p.minStock)) && dec(p.minStock).gt(0) };
  }).filter((r) => !f.belowMin || r.belowMin);
  return { rows, totalValue: money(sum(rows.map((r) => r.value))) };
}

export async function kardex(ctx: Ctx, productId: string, warehouseId?: string, from?: string, to?: string) {
  requirePerm(ctx, "inventory.read");
  return ctx.db.stockMovement.findMany({
    where: { productId, ...(warehouseId ? { warehouseId } : {}), ...(from || to ? { date: { ...(from ? { gte: civil(from) } : {}), ...(to ? { lte: civil(to) } : {}) } } : {}) },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    take: 1000,
  });
}

/** Sugestão de reposição: disponível abaixo do mínimo → comprar até o máximo (ou o dobro do mínimo, sem máximo). */
export async function replenishment(ctx: Ctx) {
  const { rows } = await stockPosition(ctx, { belowMin: true });
  return rows.map((r) => {
    const target = r.product.maxStock ? dec(r.product.maxStock) : dec(r.product.minStock).times(2);
    const suggested = qty4(target.minus(r.available));
    return { ...r, suggested: suggested.gt(0) ? suggested : dec(0), estimatedCost: money((suggested.gt(0) ? suggested : dec(0)).times(dec(r.product.lastCost))) };
  });
}
