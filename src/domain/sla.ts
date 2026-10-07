/**
 * SLA em minutos úteis: janela de atendimento do calendário (início/fim em minutos desde 00:00, no fuso do calendário),
 * dias com horas > 0 no calendário semanal e sem feriado.
 *  - Prazo = instante de abertura + N minutos úteis.
 *  - Pausas (aguardando cliente/terceiro) somam minutos úteis pausados e empurram o prazo de solução.
 *  - Prioridade pela matriz impacto × urgência (1 = alto … 3 = baixo).
 */
import type { CivilDate } from "@/lib/dates";
import { addDays } from "@/lib/dates";

export interface SlaCalendar {
  timezone: string;
  startMinute: number;
  endMinute: number;
  /** horas por dia da semana [dom..sab]; > 0 = dia útil */
  weeklyHours: number[];
  holidays: Set<CivilDate>;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Data civil e minuto do dia (com fração de segundos) do instante no fuso. */
export function localParts(d: Date, tz: string): { day: CivilDate; minute: number } {
  const p = Object.fromEntries(fmt(tz).formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) + (Number(p.second) + d.getUTCMilliseconds() / 1000) / 60 };
}

/** Instante UTC correspondente a (data civil, minuto) no fuso. */
export function zonedInstant(day: CivilDate, minute: number, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d) + minute * 60_000;
  // ajusta pelo deslocamento do fuso (duas iterações cobrem transições de horário de verão)
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const lp = localParts(new Date(t), tz);
    const [ly, lm, ld] = lp.day.split("-").map(Number);
    const asUtc = Date.UTC(ly, lm - 1, ld) + lp.minute * 60_000;
    t += guess - asUtc;
  }
  return new Date(Math.round(t));
}

function isBusinessDay(day: CivilDate, cal: SlaCalendar) {
  const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
  return (cal.weeklyHours[wd] ?? 0) > 0 && !cal.holidays.has(day);
}

/** Soma minutos úteis a um instante. */
export function addBusinessMinutes(start: Date, minutes: number, cal: SlaCalendar): Date {
  if (cal.endMinute <= cal.startMinute) throw new Error("Janela de atendimento inválida.");
  let { day, minute } = localParts(start, cal.timezone);
  let remaining = Math.max(0, minutes);
  for (let guard = 0; guard < 3660; guard++) {
    if (isBusinessDay(day, cal) && minute < cal.endMinute) {
      const from = Math.max(minute, cal.startMinute);
      const available = cal.endMinute - from;
      if (remaining <= available) return zonedInstant(day, from + remaining, cal.timezone);
      remaining -= available;
    }
    day = addDays(day, 1);
    minute = 0;
  }
  throw new Error("Prazo de SLA fora do horizonte de cálculo.");
}

/** Minutos úteis entre dois instantes (0 se b <= a). */
export function businessMinutesBetween(a: Date, b: Date, cal: SlaCalendar): number {
  if (b <= a) return 0;
  const pa = localParts(a, cal.timezone);
  const pb = localParts(b, cal.timezone);
  let total = 0;
  let day = pa.day;
  for (let guard = 0; guard < 3660; guard++) {
    if (isBusinessDay(day, cal)) {
      const from = Math.max(cal.startMinute, day === pa.day ? pa.minute : 0);
      const to = Math.min(cal.endMinute, day === pb.day ? pb.minute : 24 * 60);
      if (to > from) total += to - from;
    }
    if (day === pb.day) break;
    day = addDays(day, 1);
  }
  return Math.round(total);
}

export type Priority = "P1" | "P2" | "P3" | "P4";
/** Matriz impacto × urgência (1 alto … 3 baixo): soma 2 → P1, 3 → P2, 4 → P3, 5–6 → P4. */
export function priorityFrom(impact: number, urgency: number): Priority {
  const s = impact + urgency;
  return s <= 2 ? "P1" : s === 3 ? "P2" : s === 4 ? "P3" : "P4";
}

/** Percentual consumido do prazo de solução (minutos úteis, descontadas as pausas). */
export function slaConsumedPct(openedAt: Date, now: Date, targetMinutes: number, pausedMinutes: number, cal: SlaCalendar): number {
  if (targetMinutes <= 0) return 100;
  const used = businessMinutesBetween(openedAt, now, cal) - pausedMinutes;
  return Math.max(0, Math.round((used / targetMinutes) * 100));
}
