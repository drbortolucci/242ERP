/**
 * Datas civis x instantes.
 *  - Data civil (vencimento, competência, data do apontamento): string "YYYY-MM-DD",
 *    persistida em coluna DATE (Prisma devolve Date em 00:00Z — tratar sempre em UTC).
 *  - Instante (criação, aprovação, SLA): Date em UTC, exibido no fuso da organização.
 */
export type CivilDate = string; // YYYY-MM-DD

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCivilDate(s: string): boolean {
  const m = RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Converte data civil em Date (00:00 UTC) para gravar em coluna DATE. */
export function civil(s: CivilDate): Date {
  if (!isCivilDate(s)) throw new Error(`Data inválida: ${s}`);
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Converte Date de coluna DATE (00:00 UTC) em data civil. */
export function toCivil(d: Date): CivilDate {
  return d.toISOString().slice(0, 10);
}

/** Data civil "hoje" no fuso informado. */
export function todayIn(tz: string, now: Date = new Date()): CivilDate {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts; // en-CA => YYYY-MM-DD
}

export function addDays(s: CivilDate, n: number): CivilDate {
  const d = civil(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toCivil(d);
}

/** Soma meses preservando o dia quando possível (31/01 + 1 mês = 28 ou 29/02). */
export function addMonths(s: CivilDate, n: number): CivilDate {
  const [y, m, d] = s.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return toCivil(target);
}

export function monthStart(s: CivilDate): CivilDate {
  return s.slice(0, 7) + "-01";
}
export function monthEnd(s: CivilDate): CivilDate {
  const [y, m] = s.split("-").map(Number);
  return toCivil(new Date(Date.UTC(y, m, 0)));
}
export function monthKey(s: CivilDate | Date): string {
  return (typeof s === "string" ? s : toCivil(s)).slice(0, 7);
}
export function monthsBetween(from: CivilDate, to: CivilDate): CivilDate[] {
  const out: CivilDate[] = [];
  let cur = monthStart(from);
  const end = monthStart(to);
  while (cur <= end) {
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

export function diffDays(a: CivilDate, b: CivilDate): number {
  return Math.round((civil(b).getTime() - civil(a).getTime()) / 86400000);
}

export function eachDay(from: CivilDate, to: CivilDate): CivilDate[] {
  const out: CivilDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Dia da semana (0=domingo) de uma data civil. */
export function weekday(s: CivilDate): number {
  return civil(s).getUTCDay();
}

export function maxDate(a: CivilDate, b: CivilDate): CivilDate {
  return a > b ? a : b;
}
export function minDate(a: CivilDate, b: CivilDate): CivilDate {
  return a < b ? a : b;
}

export function formatCivil(d: CivilDate | Date | null | undefined): string {
  if (!d) return "—";
  const s = typeof d === "string" ? d : toCivil(d);
  const [y, m, dd] = s.split("-");
  return `${dd}/${m}/${y}`;
}

export function formatInstant(d: Date | null | undefined, tz = "America/Sao_Paulo"): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(d);
}

export function formatMonth(d: CivilDate | Date): string {
  const s = typeof d === "string" ? d : toCivil(d);
  const [y, m] = s.split("-");
  return `${m}/${y}`;
}

/** Componentes de data/hora locais de um instante em um fuso. */
export function zonedParts(instant: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}` as CivilDate,
    minuteOfDay: Number(p.hour) * 60 + Number(p.minute),
    second: Number(p.second),
  };
}

/** Converte data civil + minuto do dia em um fuso para instante UTC. */
export function zonedToInstant(date: CivilDate, minuteOfDay: number, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  // corrige pelo offset do fuso naquele instante (duas iterações cobrem transições de horário de verão)
  let ts = guess;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(ts), tz);
    const [py, pm, pd] = p.date.split("-").map(Number);
    const asUtc = Date.UTC(py, pm - 1, pd, Math.floor(p.minuteOfDay / 60), p.minuteOfDay % 60);
    ts = ts + (guess - asUtc);
  }
  return new Date(ts);
}
