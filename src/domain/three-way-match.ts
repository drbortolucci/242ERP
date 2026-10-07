/**
 * Conferência de 3 vias: pedido × recebimento/aceite × documento do fornecedor.
 *  Faturável pelo fornecedor = valor recebido/aceito − já faturado
 *  Tolerância% sobre o valor recebido (configurada no pedido)
 *  Divergências: valor acima do recebido (além da tolerância), valor acima do saldo do pedido, sem recebimento.
 */
import { dec, money, type DecimalInput } from "@/lib/money";

export interface MatchInput {
  poTotal: DecimalInput;
  received: DecimalInput;
  alreadyInvoiced: DecimalInput;
  invoiceAmount: DecimalInput;
  tolerancePct: DecimalInput;
}

export interface MatchResult {
  ok: boolean;
  divergences: string[];
  billable: string;
  poBalance: string;
}

export function threeWayMatch(i: MatchInput): MatchResult {
  const received = money(i.received);
  const invoiced = money(i.alreadyInvoiced);
  const amount = money(i.invoiceAmount);
  const billable = received.minus(invoiced);
  const tol = billable.times(dec(i.tolerancePct)).div(100);
  const poBalance = money(i.poTotal).minus(invoiced);
  const divergences: string[] = [];
  if (amount.lte(0)) divergences.push("Valor do documento deve ser positivo.");
  if (received.isZero()) divergences.push("Não há recebimento/aceite registrado para o pedido.");
  if (amount.gt(billable.plus(tol))) divergences.push(`Valor (${amount.toFixed(2)}) acima do recebido/aceito ainda não faturado (${billable.toFixed(2)}${dec(i.tolerancePct).gt(0) ? ` + tolerância ${dec(i.tolerancePct).toFixed(2)}%` : ""}).`);
  if (amount.gt(poBalance)) divergences.push(`Valor acima do saldo do pedido (${poBalance.toFixed(2)}).`);
  return { ok: divergences.length === 0, divergences, billable: billable.toFixed(2), poBalance: poBalance.toFixed(2) };
}

/** Compara cotações: menor total, menor prazo e preço mínimo por item. */
export function compareQuotations(quotes: { id: string; total: DecimalInput; deliveryDays: number | null; lines: { lineId: string; unitPrice: DecimalInput }[] }[]) {
  if (!quotes.length) return { cheapestId: null, fastestId: null, bestByLine: {} as Record<string, string> };
  const cheapest = [...quotes].sort((a, b) => dec(a.total).comparedTo(dec(b.total)))[0];
  const withDays = quotes.filter((q) => q.deliveryDays !== null);
  const fastest = withDays.length ? [...withDays].sort((a, b) => (a.deliveryDays ?? 0) - (b.deliveryDays ?? 0))[0] : null;
  const bestByLine: Record<string, string> = {};
  const lineIds = new Set(quotes.flatMap((q) => q.lines.map((l) => l.lineId)));
  for (const lid of lineIds) {
    const best = quotes.map((q) => ({ q, l: q.lines.find((l) => l.lineId === lid) })).filter((x) => x.l).sort((a, b) => dec(a.l!.unitPrice).comparedTo(dec(b.l!.unitPrice)))[0];
    if (best) bestByLine[lid] = best.q.id;
  }
  return { cheapestId: cheapest.id, fastestId: fastest?.id ?? null, bestByLine };
}
