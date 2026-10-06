import { describe, expect, it } from "vitest";
import { allocationByDay, allocationTotalHours, findConflicts, capacityInPeriod, type CalendarSpec } from "@/domain/capacity";
import { progressPct, evm, forecastAtCompletion } from "@/domain/project-metrics";

const cal8: CalendarSpec = { weeklyHours: [0, 8, 8, 8, 8, 8, 0], holidays: new Set(["2026-10-12"]) };
const cal6: CalendarSpec = { weeklyHours: [0, 6, 6, 6, 6, 6, 0], holidays: new Set() };
const full = { capacityPct: 100, absences: [] };

describe("capacidade e alocação em horas", () => {
  it("desconta feriados, fins de semana e ausências", () => {
    // 05/10/2026 (seg) a 16/10/2026 (sex): 10 dias úteis, 1 feriado → 9 × 8 = 72h
    expect(capacityInPeriod("2026-10-05", "2026-10-16", cal8, full).toString()).toBe("72");
    expect(capacityInPeriod("2026-10-05", "2026-10-16", cal8, { capacityPct: 50, absences: [{ start: "2026-10-05", end: "2026-10-06" }] }).toString()).toBe("28");
  });
  it("converte percentual em horas conforme o calendário do profissional", () => {
    const a = { start: "2026-10-05", end: "2026-10-09", mode: "PERCENT" as const, value: 50 };
    expect(allocationTotalHours(a, cal8, full).toString()).toBe("20");
    expect(allocationTotalHours(a, cal6, full).toString()).toBe("15"); // mesmo 50% vale menos horas em calendário de 6h
  });
  it("distribui total de horas proporcionalmente à capacidade", () => {
    const m = allocationByDay({ start: "2026-10-09", end: "2026-10-13", mode: "TOTAL_HOURS", value: 16 }, cal8, full);
    expect(m.get("2026-10-10")!.toString()).toBe("0"); // sábado
    expect(m.get("2026-10-12")!.toString()).toBe("0"); // feriado
    expect(m.get("2026-10-09")!.toString()).toBe("8");
  });
  it("detecta sobrealocação em horas e respeita tolerância", () => {
    const allocs = [
      { start: "2026-10-05", end: "2026-10-09", mode: "PERCENT" as const, value: 60 },
      { start: "2026-10-07", end: "2026-10-08", mode: "HOURS_PER_DAY" as const, value: 4 },
    ];
    const c = findConflicts(allocs, cal8, full);
    expect(c.map((x) => x.day)).toEqual(["2026-10-07", "2026-10-08"]);
    expect(c[0].allocated.toString()).toBe("8.8");
    expect(findConflicts(allocs, cal8, full, 10)).toHaveLength(0);
  });
});

describe("avanço, EVM e previsão ao término", () => {
  it("calcula avanço por critério e limita a 100%", () => {
    expect(progressPct("HOURS", { actualHours: 50, plannedHours: 200 })!.toString()).toBe("25");
    expect(progressPct("HOURS", { actualHours: 300, plannedHours: 200 })!.toString()).toBe("100");
    expect(progressPct("MILESTONES", { acceptedMilestones: 0, totalMilestones: 0 })).toBeNull();
    expect(progressPct("MANUAL", { manual: null })).toBeNull();
  });
  it("só exibe EVM quando há dados e critério objetivo", () => {
    expect(evm({ bac: 100000, plannedToDate: 0, actualCost: 10, progressPct: 10, method: "HOURS" })).toBeNull();
    expect(evm({ bac: 100000, plannedToDate: 40000, actualCost: 30000, progressPct: 35, method: "MANUAL" })).toBeNull();
    const e = evm({ bac: 100000, plannedToDate: 40000, actualCost: 30000, progressPct: 35, method: "HOURS" })!;
    expect(e.ev.toFixed(2)).toBe("35000.00");
    expect(e.spi.toString()).toBe("0.88");
    expect(e.cpi!.toString()).toBe("1.17");
  });
  it("previsão ao término não duplica compromissos", () => {
    const f = forecastAtCompletion({ actualCost: 50000, committedNotRealized: 20000, etcLabor: 30000, etcThirdPartyUncommitted: 5000, etcExpenses: 2000, recognizedRevenue: 80000, remainingRevenue: 60000 });
    expect(f.cost.toFixed(2)).toBe("107000.00");
    expect(f.revenue.toFixed(2)).toBe("140000.00");
    expect(f.margin.toFixed(2)).toBe("33000.00");
  });
});
