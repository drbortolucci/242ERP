/**
 * Custo médio móvel (regras puras, sem acesso a banco).
 *
 *  Entrada: novo valor = valor anterior + quantidade × custo unitário da entrada (arredondado a centavos);
 *           novo custo médio = novo valor ÷ nova quantidade.
 *  Saída:   custo da saída = quantidade × custo médio vigente (arredondado a centavos); o custo médio não muda.
 *           Se a saída zera o saldo, o custo da saída é exatamente o valor remanescente (não sobram centavos).
 *  Saldo negativo só é aceito quando o depósito permite; nesse caso a saída usa o último custo médio conhecido.
 */
import { dec, money, type DecimalInput } from "@/lib/money";
import type Decimal from "decimal.js";

export interface StockPosition {
  quantity: Decimal;
  avgCost: Decimal;
  value: Decimal;
}

export interface StockEffect {
  quantity: Decimal; // com sinal
  unitCost: Decimal;
  totalCost: Decimal; // com sinal
  after: StockPosition;
}

const COST_DP = 6;
const QTY_DP = 4;

export const qty4 = (v: DecimalInput) => dec(v).toDecimalPlaces(QTY_DP);
export const cost6 = (v: DecimalInput) => dec(v).toDecimalPlaces(COST_DP);

export function emptyPosition(): StockPosition {
  return { quantity: dec(0), avgCost: dec(0), value: dec(0) };
}

/** Entrada ao custo informado (compra, devolução de venda ao custo original, ajuste positivo, transferência). */
export function applyInbound(pos: StockPosition, quantityIn: DecimalInput, unitCostIn: DecimalInput): StockEffect {
  const q = qty4(quantityIn);
  const unitCost = cost6(unitCostIn);
  if (q.lte(0)) throw new Error("Quantidade de entrada deve ser positiva.");
  if (unitCost.lt(0)) throw new Error("Custo unitário não pode ser negativo.");
  const totalCost = money(q.times(unitCost));
  const quantity = qty4(pos.quantity.plus(q));
  const value = money(pos.value.plus(totalCost));
  const avgCost = quantity.gt(0) ? cost6(value.div(quantity)) : unitCost;
  return { quantity: q, unitCost, totalCost, after: { quantity, avgCost, value: quantity.isZero() ? dec(0) : value } };
}

/** Saída ao custo médio vigente (venda, consumo, ajuste negativo, transferência, devolução a fornecedor). */
export function applyOutbound(pos: StockPosition, quantityOut: DecimalInput, allowNegative = false): StockEffect {
  const q = qty4(quantityOut);
  if (q.lte(0)) throw new Error("Quantidade de saída deve ser positiva.");
  const remaining = qty4(pos.quantity.minus(q));
  if (remaining.lt(0) && !allowNegative) throw new Error(`Saldo insuficiente: disponível ${pos.quantity.toFixed()}, solicitado ${q.toFixed()}.`);
  const unitCost = pos.avgCost;
  const totalCost = remaining.isZero() ? pos.value : money(q.times(unitCost));
  const value = remaining.isZero() ? dec(0) : money(pos.value.minus(totalCost));
  return { quantity: q.negated(), unitCost, totalCost: totalCost.negated(), after: { quantity: remaining, avgCost: unitCost, value } };
}

/** Saída a custo específico (estorno de uma entrada: retira exatamente o que entrou). */
export function applyOutboundAtCost(pos: StockPosition, quantityOut: DecimalInput, totalCostOut: DecimalInput, allowNegative = false): StockEffect {
  const q = qty4(quantityOut);
  const total = money(totalCostOut);
  const remaining = qty4(pos.quantity.minus(q));
  if (remaining.lt(0) && !allowNegative) throw new Error(`Saldo insuficiente para estornar: disponível ${pos.quantity.toFixed()}, necessário ${q.toFixed()}.`);
  const value = remaining.isZero() ? dec(0) : money(pos.value.minus(total));
  const avgCost = remaining.gt(0) ? cost6(value.div(remaining)) : pos.avgCost;
  return { quantity: q.negated(), unitCost: q.isZero() ? dec(0) : cost6(total.div(q)), totalCost: total.negated(), after: { quantity: remaining, avgCost, value } };
}

/** Diferença de inventário: positiva entra ao custo médio vigente (ou último custo), negativa sai ao custo médio. */
export function countDifference(systemQty: DecimalInput, countedQty: DecimalInput) {
  return qty4(dec(countedQty).minus(dec(systemQty)));
}

/** Valor líquido de cada linha: arredondar(quantidade × preço, 2) − desconto da linha. */
export function lineTotals(lines: { quantity: DecimalInput; unitPrice: DecimalInput; discountAmount?: DecimalInput }[]) {
  return lines.map((l) => {
    const gross = money(dec(l.quantity).times(dec(l.unitPrice)));
    const discount = money(l.discountAmount ?? 0);
    if (discount.gt(gross)) throw new Error("Desconto maior que o valor do item.");
    return money(gross.minus(discount));
  });
}
