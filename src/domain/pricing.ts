/**
 * Precificação de propostas — funções puras.
 *
 * Fórmulas (docs/FORMULAS.md):
 *  receita da linha  = horas × tarifa (LABOR) | quantidade × preço unitário (demais)
 *  custo da linha    = horas × custo/hora (LABOR) | quantidade × custo unitário (demais)
 *  Receita bruta     = Σ receita das linhas faturáveis
 *  Desconto          = Receita bruta × desconto%
 *  Receita líquida   = Receita bruta − Desconto
 *  Tributos estim.   = Receita líquida × tributos% (parâmetro informado; não é regra fiscal)
 *  Custo total       = custo de pessoal + terceiros/licenças + despesas
 *  Margem de contribuição (MC) = Receita líquida − Tributos estimados − Custo total
 *  Margem %          = MC ÷ Receita líquida × 100
 *  Markup %          = (Receita líquida − Custo total) ÷ Custo total × 100
 * Arredondamento: cada linha e cada total em 2 casas (HALF_UP).
 */
import { dec, money, pct, sum, type DecimalInput } from "@/lib/money";
import type Decimal from "decimal.js";

export type LineKind = "LABOR" | "FIXED" | "RECURRING" | "EXPENSE" | "THIRD_PARTY" | "LICENSE";

export interface PricingLine {
  kind: LineKind;
  hours?: DecimalInput;
  quantity?: DecimalInput;
  unitPrice: DecimalInput;
  unitCost?: DecimalInput;
  billable?: boolean;
}

export interface PricingTotals {
  grossRevenue: Decimal;
  discountAmount: Decimal;
  netRevenue: Decimal;
  taxAmount: Decimal;
  laborCost: Decimal;
  thirdPartyCost: Decimal;
  expenseCost: Decimal;
  totalCost: Decimal;
  contributionMargin: Decimal;
  marginPct: Decimal | null;
  markup: Decimal | null;
  totalHours: Decimal;
  lines: { revenue: Decimal; cost: Decimal }[];
}

export function lineAmounts(l: PricingLine) {
  const base = l.kind === "LABOR" ? dec(l.hours) : dec(l.quantity ?? 1);
  const revenue = l.billable === false ? money(0) : money(base.times(dec(l.unitPrice)));
  const cost = money(base.times(dec(l.unitCost ?? 0)));
  return { revenue, cost };
}

export function priceProposal(lines: PricingLine[], discountPct: DecimalInput = 0, taxRatePct: DecimalInput = 0): PricingTotals {
  const d = dec(discountPct);
  if (d.lt(0) || d.gt(100)) throw new Error("Desconto deve estar entre 0 e 100%");
  if (dec(taxRatePct).lt(0) || dec(taxRatePct).gt(100)) throw new Error("Tributos estimados devem estar entre 0 e 100%");
  for (const l of lines) {
    if (dec(l.unitPrice).lt(0) || dec(l.unitCost).lt(0) || dec(l.hours).lt(0) || dec(l.quantity ?? 0).lt(0)) throw new Error("Valores de linha não podem ser negativos");
  }
  const amounts = lines.map(lineAmounts);
  const grossRevenue = money(sum(amounts.map((a) => a.revenue)));
  const discountAmount = money(grossRevenue.times(d).div(100));
  const netRevenue = grossRevenue.minus(discountAmount);
  const taxAmount = money(netRevenue.times(dec(taxRatePct)).div(100));
  const costBy = (kinds: LineKind[]) => money(sum(lines.map((l, i) => (kinds.includes(l.kind) ? amounts[i].cost : 0))));
  const laborCost = costBy(["LABOR"]);
  const thirdPartyCost = costBy(["THIRD_PARTY", "LICENSE", "FIXED", "RECURRING"]);
  const expenseCost = costBy(["EXPENSE"]);
  const totalCost = laborCost.plus(thirdPartyCost).plus(expenseCost);
  const contributionMargin = netRevenue.minus(taxAmount).minus(totalCost);
  return {
    grossRevenue, discountAmount, netRevenue, taxAmount, laborCost, thirdPartyCost, expenseCost, totalCost, contributionMargin,
    marginPct: pct(contributionMargin, netRevenue),
    markup: totalCost.isZero() ? null : pct(netRevenue.minus(totalCost), totalCost),
    totalHours: sum(lines.filter((l) => l.kind === "LABOR").map((l) => dec(l.hours))),
    lines: amounts,
  };
}

/** Parcelamento de um valor conforme condição de pagamento (soma exata; centavos na última parcela). */
export function splitInstallments(total: DecimalInput, installments: { days: number; percent: string }[]) {
  const t = money(total);
  let acc = money(0);
  return installments.map((ins, i) => {
    const amount = i === installments.length - 1 ? t.minus(acc) : money(t.times(dec(ins.percent)).div(100));
    acc = acc.plus(amount);
    return { days: ins.days, amount };
  });
}
