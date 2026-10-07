/**
 * Faturamento: retenções configuradas pela empresa usuária (o sistema NÃO define alíquotas — apenas aplica as regras
 * cadastradas e validadas pelo responsável fiscal), valor líquido e parcelas pela condição de pagamento.
 */
import { addDays, type CivilDate } from "@/lib/dates";
import { dec, money, sum, type DecimalInput } from "@/lib/money";
import { splitInstallments } from "./pricing";

export interface WithholdingRuleInput { code: string; name: string; ratePct: DecimalInput; minBaseAmount: DecimalInput | null; validFrom: CivilDate; validTo: CivilDate | null }

export function computeWithholdings(gross: DecimalInput, rules: WithholdingRuleInput[], date: CivilDate) {
  const g = money(gross);
  const lines = rules
    .filter((r) => r.validFrom <= date && (!r.validTo || r.validTo >= date))
    .filter((r) => r.minBaseAmount === null || g.gte(dec(r.minBaseAmount)))
    .map((r) => ({ code: r.code, name: r.name, ratePct: dec(r.ratePct).toFixed(4), base: g.toFixed(2), amount: money(g.times(dec(r.ratePct)).div(100)).toFixed(2) }));
  const total = money(sum(lines.map((l) => l.amount)));
  return { lines, total, net: money(g.minus(total)) };
}

/** Parcelas do líquido a receber; a última absorve o arredondamento (soma exata). */
export function receivableInstallments(net: DecimalInput, issueDate: CivilDate, term: { days: number; percent: string }[] | null, defaultDueDays: number) {
  const plan = term && term.length ? term : [{ days: defaultDueDays, percent: "100" }];
  const total = plan.reduce((s, p) => s.plus(dec(p.percent)), dec(0));
  if (!total.eq(100)) throw new Error("Condição de pagamento deve somar 100%.");
  return splitInstallments(net, plan).map((p, i) => ({ installment: i + 1, installments: plan.length, dueDate: addDays(issueDate, p.days), amount: p.amount }));
}

/** Liquidação: total em caixa = principal + juros + multa − desconto. */
export function settlementTotal(principal: DecimalInput, interest: DecimalInput = 0, fine: DecimalInput = 0, discount: DecimalInput = 0) {
  return money(dec(principal).plus(dec(interest)).plus(dec(fine)).minus(dec(discount)));
}

/** Faixas de vencimento (aging) a partir de hoje. */
export function agingBucket(due: CivilDate, today: CivilDate): "A_VENCER" | "1_30" | "31_60" | "61_90" | "90_MAIS" {
  const days = Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000);
  if (days <= 0) return "A_VENCER";
  if (days <= 30) return "1_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "90_MAIS";
}
