import { clsx, type ClassValue } from "clsx";
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = obj[k];
  return out;
}
export function uniq<T>(arr: (T | null | undefined)[]): T[] {
  return [...new Set(arr.filter((x): x is T => x !== null && x !== undefined))];
}
export function groupBy<T, K extends string>(rows: T[], key: (r: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const r of rows) (out[key(r)] ||= []).push(r);
  return out;
}

type Plain<T> = { [K in keyof T]: T[K] extends { toFixed(n?: number): string; isZero(): boolean } ? string : T[K] extends { toFixed(n?: number): string; isZero(): boolean } | null ? string | null : T[K] };
/** Converte valores Decimal (Prisma/decimal.js) em string — props de Componentes Cliente aceitam apenas objetos simples. */
export function toPlain<T extends object>(obj: T): Plain<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && typeof (v as { toFixed?: unknown }).toFixed === "function" ? String(v) : v;
  return out as Plain<T>;
}
