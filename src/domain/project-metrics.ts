/**
 * Avanço, valor agregado e previsões de projeto — metodologia em docs/FORMULAS.md.
 * Nada é "inventado": quando faltam dados, a função retorna null e a interface não exibe o indicador.
 */
import { dec, money, pct, sum, type DecimalInput } from "@/lib/money";
import type Decimal from "decimal.js";

export type ProgressMethod = "HOURS" | "MILESTONES" | "TASK_WEIGHT" | "MANUAL";

export function progressPct(method: ProgressMethod, data: { actualHours?: DecimalInput; plannedHours?: DecimalInput; acceptedMilestones?: DecimalInput; totalMilestones?: DecimalInput; doneWeight?: DecimalInput; totalWeight?: DecimalInput; manual?: DecimalInput | null }): Decimal | null {
  let p: Decimal | null = null;
  if (method === "HOURS") p = pct(data.actualHours ?? 0, data.plannedHours ?? 0);
  if (method === "MILESTONES") p = pct(data.acceptedMilestones ?? 0, data.totalMilestones ?? 0);
  if (method === "TASK_WEIGHT") p = pct(data.doneWeight ?? 0, data.totalWeight ?? 0);
  if (method === "MANUAL") p = data.manual === null || data.manual === undefined ? null : dec(data.manual);
  if (p === null) return null;
  return Decimal_min100(p);
}
function Decimal_min100(p: Decimal) {
  return p.gt(100) ? dec(100) : p.lt(0) ? dec(0) : p;
}

export interface EvmInput {
  bac: DecimalInput; // orçamento de custo na linha de base vigente
  plannedToDate: DecimalInput; // PV: custo planejado acumulado até a data (distribuição mensal da linha de base)
  actualCost: DecimalInput; // AC
  progressPct: DecimalInput | null; // avanço físico pelo critério do projeto
  method: ProgressMethod;
}

/** EVM só quando há linha de base com distribuição, avanço por critério objetivo e custo real. */
export function evm(i: EvmInput) {
  if (i.progressPct === null || i.method === "MANUAL") return null;
  if (dec(i.bac).lte(0) || dec(i.plannedToDate).lte(0)) return null;
  const ev = money(dec(i.bac).times(dec(i.progressPct)).div(100));
  const pv = money(i.plannedToDate);
  const ac = money(i.actualCost);
  return { pv, ev, ac, spi: ev.div(pv).toDecimalPlaces(2), cpi: ac.isZero() ? null : ev.div(ac).toDecimalPlaces(2) };
}

export interface ForecastInput {
  actualCost: DecimalInput; // realizado (pessoal + terceiros + despesas + outros)
  committedNotRealized: DecimalInput; // pedidos de compra emitidos ainda não realizados
  etcLabor: DecimalInput; // estimativa para concluir: pessoal
  etcThirdPartyUncommitted: DecimalInput; // terceiros a contratar além dos compromissos (evita duplicidade)
  etcExpenses: DecimalInput;
  recognizedRevenue: DecimalInput;
  remainingRevenue: DecimalInput;
}

/**
 * Previsão ao término (EAC):
 *  Custo EAC   = Realizado + Comprometido não realizado + ETC (pessoal + terceiros NÃO comprometidos + despesas)
 *  Receita EAC = Receita reconhecida + Receita remanescente
 *  Margem EAC  = Receita EAC − Custo EAC
 * Os compromissos entram uma única vez: o ETC de terceiros considera apenas o que ainda não foi contratado.
 */
export function forecastAtCompletion(i: ForecastInput) {
  const etc = money(sum([i.etcLabor, i.etcThirdPartyUncommitted, i.etcExpenses]));
  const cost = money(sum([i.actualCost, i.committedNotRealized, etc]));
  const revenue = money(sum([i.recognizedRevenue, i.remainingRevenue]));
  const margin = revenue.minus(cost);
  return { etc, cost, revenue, margin, marginPct: pct(margin, revenue) };
}
