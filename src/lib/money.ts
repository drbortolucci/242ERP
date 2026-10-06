/**
 * Dinheiro com representação decimal exata (decimal.js). Nunca use number para valores financeiros.
 *
 * Regras de arredondamento (documentadas em docs/FORMULAS.md):
 *  - Valores monetários: 2 casas, ROUND_HALF_UP (arredondamento comercial).
 *  - Horas/quantidades: 2 casas, ROUND_HALF_UP.
 *  - Tarifas e custos unitários: 4 casas, ROUND_HALF_UP.
 *  - Percentuais exibidos: 2 casas; armazenados com 4.
 *  - Cálculos intermediários usam precisão total; arredonda-se apenas no resultado persistido.
 *  - Rateio/parcelamento: distribui arredondado e ajusta a diferença de centavos na última parcela,
 *    garantindo soma exata do total.
 */
import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type DecimalInput = Decimal | string | number | bigint | { toString(): string } | null | undefined;
export { Decimal };

export function dec(v: DecimalInput): Decimal {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  if (v instanceof Decimal) return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("Número inválido");
    return new Decimal(v);
  }
  return new Decimal(v.toString());
}

export const ZERO = new Decimal(0);

export function money(v: DecimalInput): Decimal {
  return dec(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
export function qty(v: DecimalInput): Decimal {
  return dec(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
export function rate(v: DecimalInput): Decimal {
  return dec(v).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export function sum(values: DecimalInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new Decimal(0));
}

export function sumBy<T>(rows: T[], pick: (r: T) => DecimalInput): Decimal {
  return rows.reduce<Decimal>((acc, r) => acc.plus(dec(pick(r))), new Decimal(0));
}

/** Percentual de `part` sobre `whole` (0-100), 4 casas. Retorna null se whole = 0. */
export function pct(part: DecimalInput, whole: DecimalInput): Decimal | null {
  const w = dec(whole);
  if (w.isZero()) return null;
  return dec(part).div(w).times(100).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/** Aplica percentual (ex.: 12.5 => 12,5%) sobre valor, sem arredondar. */
export function applyPct(value: DecimalInput, percent: DecimalInput): Decimal {
  return dec(value).times(dec(percent)).div(100);
}

/**
 * Divide um total monetário segundo pesos (percentuais ou quaisquer proporções),
 * garantindo que a soma das partes seja exatamente o total (diferença na última parte).
 */
export function allocate(total: DecimalInput, weights: DecimalInput[]): Decimal[] {
  const t = money(total);
  if (weights.length === 0) return [];
  const ws = weights.map(dec);
  const wsum = sum(ws);
  if (wsum.isZero()) throw new Error("Pesos de rateio somam zero");
  const parts: Decimal[] = [];
  let acc = new Decimal(0);
  ws.forEach((w, i) => {
    if (i === ws.length - 1) {
      parts.push(t.minus(acc));
    } else {
      const p = money(t.times(w).div(wsum));
      parts.push(p);
      acc = acc.plus(p);
    }
  });
  return parts;
}

export function min(a: DecimalInput, b: DecimalInput): Decimal {
  return Decimal.min(dec(a), dec(b));
}
export function max(a: DecimalInput, b: DecimalInput): Decimal {
  return Decimal.max(dec(a), dec(b));
}

/** Serialização para string fixa (2 casas) — usar em payloads/JSON. */
export function moneyStr(v: DecimalInput): string {
  return money(v).toFixed(2);
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export function formatMoney(v: DecimalInput, currency = "BRL"): string {
  const s = money(v).toFixed(2);
  if (currency === "BRL") return brl.format(Number(s));
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(Number(s));
}
export function formatQty(v: DecimalInput, digits = 2): string {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(
    Number(dec(v).toFixed(digits)),
  );
}
export function formatPct(v: DecimalInput | null): string {
  if (v === null || v === undefined) return "—";
  return `${formatQty(v, 2)}%`;
}

/** Converte entrada de usuário pt-BR ("1.234,56" ou "1234.56") em Decimal. Lança erro se inválida. */
export function parseMoneyInput(raw: string): Decimal {
  const s = raw.trim().replace(/\s|R\$/g, "");
  if (!s) return new Decimal(0);
  let normalized = s;
  if (s.includes(",")) normalized = s.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) throw new Error(`Valor inválido: ${raw}`);
  return new Decimal(normalized);
}
