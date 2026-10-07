/**
 * Capacidade e alocação em HORAS (nunca soma percentuais de calendários diferentes sem converter).
 *  capacidade(dia) = horas do calendário no dia da semana × capacidade% do profissional ; 0 em feriados e ausências
 *  Alocação PERCENT        → horas(dia) = capacidade(dia) × %
 *  Alocação HOURS_PER_DAY  → horas(dia) = valor, somente em dias úteis do calendário
 *  Alocação TOTAL_HOURS    → total distribuído proporcionalmente à capacidade dos dias do período
 *  Sobrealocação: Σ alocado(dia) > capacidade(dia) × (1 + tolerância%)
 */
import { dec, qty, sum, type DecimalInput } from "@/lib/money";
import { eachDay, weekday, type CivilDate } from "@/lib/dates";
import type Decimal from "decimal.js";

export interface CalendarSpec {
  weeklyHours: DecimalInput[]; // [dom..sáb]
  holidays: Set<CivilDate>;
}
export interface ProfessionalSpec {
  capacityPct: DecimalInput;
  absences: { start: CivilDate; end: CivilDate }[];
}
export interface AllocationSpec {
  id?: string;
  start: CivilDate;
  end: CivilDate;
  mode: "PERCENT" | "HOURS_PER_DAY" | "TOTAL_HOURS";
  value: DecimalInput;
}

export function dayCapacity(day: CivilDate, cal: CalendarSpec, prof: ProfessionalSpec): Decimal {
  if (cal.holidays.has(day)) return dec(0);
  if (prof.absences.some((a) => day >= a.start && day <= a.end)) return dec(0);
  return dec(cal.weeklyHours[weekday(day)] ?? 0).times(dec(prof.capacityPct)).div(100);
}

/** Base de dias "úteis" do calendário (sem considerar ausências) para HOURS_PER_DAY. */
function isWorkingDay(day: CivilDate, cal: CalendarSpec) {
  return !cal.holidays.has(day) && dec(cal.weeklyHours[weekday(day)] ?? 0).gt(0);
}

export function allocationByDay(a: AllocationSpec, cal: CalendarSpec, prof: ProfessionalSpec): Map<CivilDate, Decimal> {
  const days = eachDay(a.start, a.end);
  const out = new Map<CivilDate, Decimal>();
  if (a.mode === "PERCENT") {
    for (const d of days) out.set(d, dayCapacity(d, cal, prof).times(dec(a.value)).div(100));
  } else if (a.mode === "HOURS_PER_DAY") {
    for (const d of days) out.set(d, isWorkingDay(d, cal) ? dec(a.value) : dec(0));
  } else {
    const caps = days.map((d) => dayCapacity(d, cal, prof));
    const total = sum(caps);
    if (total.isZero()) {
      // sem capacidade no período: distribui pelos dias úteis (gerará conflito)
      const wd = days.filter((d) => isWorkingDay(d, cal));
      for (const d of days) out.set(d, wd.includes(d) ? dec(a.value).div(wd.length || 1) : dec(0));
    } else days.forEach((d, i) => out.set(d, dec(a.value).times(caps[i]).div(total)));
  }
  return out;
}

export function allocationTotalHours(a: AllocationSpec, cal: CalendarSpec, prof: ProfessionalSpec) {
  if (a.mode === "TOTAL_HOURS") return qty(a.value);
  return qty(sum([...allocationByDay(a, cal, prof).values()]));
}

export interface ConflictDay {
  day: CivilDate;
  capacity: Decimal;
  allocated: Decimal;
  excess: Decimal;
}

/** Dias em que a soma das alocações (existentes + nova) excede a capacidade com tolerância. */
export function findConflicts(allocs: AllocationSpec[], cal: CalendarSpec, prof: ProfessionalSpec, tolerancePct: DecimalInput = 0, window?: { start: CivilDate; end: CivilDate }): ConflictDay[] {
  const totals = new Map<CivilDate, Decimal>();
  for (const a of allocs) for (const [d, h] of allocationByDay(a, cal, prof)) {
    if (window && (d < window.start || d > window.end)) continue;
    totals.set(d, (totals.get(d) ?? dec(0)).plus(h));
  }
  const out: ConflictDay[] = [];
  for (const [d, allocated] of [...totals.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    const capacity = dayCapacity(d, cal, prof);
    const limit = capacity.times(dec(100).plus(dec(tolerancePct))).div(100);
    if (allocated.gt(limit.plus("0.005"))) out.push({ day: d, capacity: qty(capacity), allocated: qty(allocated), excess: qty(allocated.minus(capacity)) });
  }
  return out;
}

export function capacityInPeriod(start: CivilDate, end: CivilDate, cal: CalendarSpec, prof: ProfessionalSpec) {
  return qty(sum(eachDay(start, end).map((d) => dayCapacity(d, cal, prof))));
}
