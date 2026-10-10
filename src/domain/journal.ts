/**
 * Partidas dobradas (regras puras): normalização de linhas e verificação de equilíbrio.
 * Valor negativo em um lado é movido para o outro lado (ex.: estorno de liquidação com valores negativos).
 */
import { dec, money, sum, type DecimalInput } from "@/lib/money";
import type Decimal from "decimal.js";

export interface DraftLine { account: string; debit?: DecimalInput; credit?: DecimalInput; partyId?: string | null; costCenterId?: string | null; memo?: string | null }
export interface NormalLine { account: string; debit: Decimal; credit: Decimal; partyId: string | null; costCenterId: string | null; memo: string | null }

export function normalizeLines(lines: DraftLine[]): NormalLine[] {
  const out: NormalLine[] = [];
  for (const l of lines) {
    const net = money(dec(l.debit ?? 0).minus(dec(l.credit ?? 0)));
    if (net.isZero()) continue;
    out.push({ account: l.account, debit: net.gt(0) ? net : dec(0), credit: net.lt(0) ? net.negated() : dec(0), partyId: l.partyId ?? null, costCenterId: l.costCenterId ?? null, memo: l.memo ?? null });
  }
  return out;
}

export function totals(lines: { debit: DecimalInput; credit: DecimalInput }[]) {
  return { debit: money(sum(lines.map((l) => l.debit))), credit: money(sum(lines.map((l) => l.credit))) };
}

export function isBalanced(lines: { debit: DecimalInput; credit: DecimalInput }[]) {
  const t = totals(lines);
  return t.debit.eq(t.credit) && t.debit.gt(0);
}

/** Lançamento inverso (estorno): troca débitos e créditos. */
export function invert(lines: NormalLine[]): NormalLine[] {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
}

/** Saldo no sentido natural da conta: devedora = débitos − créditos; credora = créditos − débitos. */
export function naturalBalance(nature: string, debit: DecimalInput, credit: DecimalInput) {
  return nature === "ASSET" || nature === "EXPENSE" ? money(dec(debit).minus(dec(credit))) : money(dec(credit).minus(dec(debit)));
}
