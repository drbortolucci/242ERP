/**
 * Banco de horas AMS — consumo FIFO por vencimento.
 *  Créditos: franquia mensal (expira ao fim do mês, ou após N meses quando acumulável) e compras pré-pagas.
 *  Um débito na data D consome créditos já vigentes (mês ≤ D) e não vencidos (vencimento ≥ D), do que vence antes.
 *  O que não couber é excedente (valorizado pela tarifa de excedente do contrato).
 */
import { dec, qty, type DecimalInput } from "@/lib/money";
import type Decimal from "decimal.js";
import type { CivilDate } from "@/lib/dates";

export interface Credit { id: string; validFrom: CivilDate; expiresOn: CivilDate | null; remaining: DecimalInput }
export interface Consumption { allocations: { creditId: string; hours: Decimal }[]; overage: Decimal }

export function consumeFifo(credits: Credit[], date: CivilDate, hours: DecimalInput): Consumption {
  let rest = qty(hours);
  const usable = credits
    .filter((c) => c.validFrom <= date && (c.expiresOn === null || c.expiresOn >= date) && dec(c.remaining).gt(0))
    .sort((a, b) => (a.expiresOn ?? "9999-12-31").localeCompare(b.expiresOn ?? "9999-12-31") || a.validFrom.localeCompare(b.validFrom) || a.id.localeCompare(b.id));
  const allocations: Consumption["allocations"] = [];
  for (const c of usable) {
    if (rest.lte(0)) break;
    const take = Decimal_min(rest, dec(c.remaining));
    allocations.push({ creditId: c.id, hours: take });
    rest = rest.minus(take);
  }
  return { allocations, overage: rest.gt(0) ? rest : dec(0) };
}
function Decimal_min(a: Decimal, b: Decimal) {
  return a.lt(b) ? a : b;
}

/** Vencimento do crédito de franquia do mês. */
export function franchiseExpiry(month: CivilDate, policy: string | null | undefined, expiryMonths: number | null | undefined): CivilDate | null {
  const [y, m] = month.split("-").map(Number);
  const endOf = (offset: number) => new Date(Date.UTC(y, m - 1 + offset + 1, 0)).toISOString().slice(0, 10);
  if (policy === "ACCUMULATE") return endOf(Math.max(0, expiryMonths ?? 0));
  if (policy === "PREPAID") return null;
  return endOf(0);
}
