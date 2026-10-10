/**
 * Núcleo do estoque: lançamento de movimentos com custo médio móvel, sob bloqueio do saldo (produto × depósito).
 * Toda alteração de saldo passa por postMovement, dentro da transação da operação de origem
 * (recebimento de compra, entrega de pedido, inventário, ajuste, transferência).
 */
import { randomUUID } from "node:crypto";
import type { Ctx } from "@/server/context";
import type { TenantTx } from "@/server/tenant-db";
import { nextNumber } from "@/server/sequences";
import { assertPeriodOpen } from "@/server/periods";
import { civil, toCivil, type CivilDate } from "@/lib/dates";
import { dec, type DecimalInput } from "@/lib/money";
import { rule } from "@/lib/errors";
import { applyInbound, applyOutbound, applyOutboundAtCost, type StockPosition } from "@/domain/stock";

export const INBOUND_TYPES = ["OPENING", "PURCHASE_RECEIPT", "SALE_RETURN", "ADJUSTMENT_IN", "TRANSFER_IN"] as const;
export const OUTBOUND_TYPES = ["PURCHASE_RETURN", "SALE", "ADJUSTMENT_OUT", "CONSUMPTION", "TRANSFER_OUT"] as const;

export const MOVEMENT_LABEL: Record<string, string> = {
  OPENING: "Saldo inicial", PURCHASE_RECEIPT: "Entrada por compra", PURCHASE_RETURN: "Devolução a fornecedor", SALE: "Saída por venda", SALE_RETURN: "Devolução de venda",
  ADJUSTMENT_IN: "Ajuste de entrada", ADJUSTMENT_OUT: "Ajuste de saída", COUNT_ADJUSTMENT: "Ajuste de inventário", CONSUMPTION: "Consumo / aplicação",
  TRANSFER_IN: "Transferência (entrada)", TRANSFER_OUT: "Transferência (saída)", REVERSAL: "Estorno",
};

export interface MovementInput {
  productId: string;
  warehouseId: string;
  date: CivilDate;
  type: string;
  /** Entrada: quantidade positiva com custo unitário. Saída: quantidade positiva (sai ao custo médio). */
  quantity: DecimalInput;
  direction: "IN" | "OUT";
  unitCost?: DecimalInput;
  /** Saída a custo específico (estorno de entrada) */
  totalCost?: DecimalInput;
  sourceType?: string;
  sourceId?: string;
  projectId?: string | null;
  costCenterId?: string | null;
  partyId?: string | null;
  reversalOfId?: string;
  reason?: string;
  idempotencyKey?: string;
}

/** Garante a linha de saldo e a bloqueia até o fim da transação (serializa movimentos do mesmo produto/depósito). */
async function lockBalance(ctx: Ctx, tx: TenantTx, companyId: string, productId: string, warehouseId: string) {
  await tx.$queryRawUnsafe(
    `INSERT INTO "StockBalance" ("id","organizationId","companyId","productId","warehouseId","updatedAt") VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT ("organizationId","productId","warehouseId") DO NOTHING`,
    randomUUID(), ctx.orgId, companyId, productId, warehouseId,
  );
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "StockBalance" WHERE "organizationId" = $1 AND "productId" = $2 AND "warehouseId" = $3 FOR UPDATE`, ctx.orgId, productId, warehouseId);
  return tx.stockBalance.findFirstOrThrow({ where: { id: rows[0].id } });
}

export async function postMovement(ctx: Ctx, tx: TenantTx, i: MovementInput) {
  const [product, wh] = await Promise.all([tx.product.findFirst({ where: { id: i.productId } }), tx.warehouse.findFirst({ where: { id: i.warehouseId } })]);
  if (!product) throw rule("Produto inválido.");
  if (!product.tracksStock) throw rule(`O produto ${product.code} não controla estoque.`);
  if (!wh || !wh.active) throw rule("Depósito inválido ou inativo.");
  if (i.idempotencyKey) {
    const dup = await tx.stockMovement.findFirst({ where: { idempotencyKey: i.idempotencyKey } });
    if (dup) return dup;
  }
  await assertPeriodOpen(tx, wh.companyId, i.date, "Movimento de estoque");
  const bal = await lockBalance(ctx, tx, wh.companyId, product.id, wh.id);
  if (bal.lastMovementAt && toCivil(bal.lastMovementAt) > i.date) {
    throw rule(`${product.code}: já existe movimento em ${toCivil(bal.lastMovementAt).split("-").reverse().join("/")} neste depósito. Movimentos devem respeitar a ordem cronológica (custo médio).`);
  }
  const pos: StockPosition = { quantity: dec(bal.quantity), avgCost: dec(bal.avgCost), value: dec(bal.value) };
  let eff;
  try {
    if (i.direction === "IN") {
      const unitCost = i.unitCost ?? (pos.avgCost.gt(0) ? pos.avgCost : product.lastCost);
      eff = applyInbound(pos, i.quantity, unitCost);
    } else if (i.totalCost !== undefined) {
      eff = applyOutboundAtCost(pos, i.quantity, i.totalCost, wh.allowNegative);
    } else {
      eff = applyOutbound(pos, i.quantity, wh.allowNegative);
    }
  } catch (e) {
    throw rule(`${product.code} — ${product.name}: ${(e as Error).message}`);
  }
  const number = await nextNumber(tx, ctx.orgId, "STOCK_MOVEMENT");
  const mv = await tx.stockMovement.create({
    data: {
      organizationId: ctx.orgId, companyId: wh.companyId, number, productId: product.id, warehouseId: wh.id, date: civil(i.date), type: i.type,
      quantity: eff.quantity, unitCost: eff.unitCost, totalCost: eff.totalCost, balanceQty: eff.after.quantity, balanceAvgCost: eff.after.avgCost, balanceValue: eff.after.value,
      sourceType: i.sourceType ?? "MANUAL", sourceId: i.sourceId ?? null, projectId: i.projectId ?? null, costCenterId: i.costCenterId ?? null, partyId: i.partyId ?? null,
      reversalOfId: i.reversalOfId ?? null, reason: i.reason ?? null, idempotencyKey: i.idempotencyKey ?? randomUUID(), createdById: ctx.userId,
    },
  });
  await tx.stockBalance.update({ where: { id: bal.id }, data: { quantity: eff.after.quantity, avgCost: eff.after.avgCost, value: eff.after.value, lastMovementAt: civil(i.date) } });
  if (i.direction === "IN" && i.type === "PURCHASE_RECEIPT") await tx.product.update({ where: { id: product.id }, data: { lastCost: eff.unitCost } });
  return mv;
}

/** Estorna um movimento: entrada sai pelo mesmo custo total; saída retorna pelo mesmo custo unitário. */
export async function reverseMovement(ctx: Ctx, tx: TenantTx, movementId: string, date: CivilDate, reason: string) {
  const m = await tx.stockMovement.findFirst({ where: { id: movementId } });
  if (!m) throw rule("Movimento não encontrado.");
  if (m.reversalOfId) throw rule("Não é possível estornar um estorno.");
  if (await tx.stockMovement.findFirst({ where: { reversalOfId: m.id } })) throw rule(`Movimento ${m.number} já estornado.`);
  const q = dec(m.quantity);
  const base = { productId: m.productId, warehouseId: m.warehouseId, date, type: "REVERSAL", sourceType: m.sourceType ?? undefined, sourceId: m.sourceId ?? undefined, projectId: m.projectId, costCenterId: m.costCenterId, partyId: m.partyId, reversalOfId: m.id, reason, idempotencyKey: `REV:${m.id}` };
  if (q.gt(0)) return postMovement(ctx, tx, { ...base, direction: "OUT", quantity: q, totalCost: dec(m.totalCost) });
  return postMovement(ctx, tx, { ...base, direction: "IN", quantity: q.negated(), unitCost: dec(m.unitCost) });
}

export async function availableQty(tx: Pick<TenantTx, "stockBalance">, productId: string, warehouseId: string) {
  const b = await tx.stockBalance.findFirst({ where: { productId, warehouseId } });
  return b ? dec(b.quantity).minus(dec(b.reserved)) : dec(0);
}
