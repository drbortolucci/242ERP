import { describe, expect, it } from "vitest";
import { addBusinessMinutes, businessMinutesBetween, priorityFrom, localParts, zonedInstant, type SlaCalendar } from "@/domain/sla";
import { consumeFifo, franchiseExpiry } from "@/domain/hour-bank";

// Seg–sex, 09:00–18:00, São Paulo (UTC−3); feriado em 2026-10-12 (segunda)
const cal: SlaCalendar = { timezone: "America/Sao_Paulo", startMinute: 540, endMinute: 1080, weeklyHours: [0, 8, 8, 8, 8, 8, 0], holidays: new Set(["2026-10-12"]) };
const at = (iso: string) => new Date(iso);

describe("SLA em minutos úteis", () => {
  it("converte fuso corretamente", () => {
    expect(localParts(at("2026-10-07T12:00:00Z"), cal.timezone)).toEqual({ day: "2026-10-07", minute: 540 });
    expect(zonedInstant("2026-10-07", 540, cal.timezone).toISOString()).toBe("2026-10-07T12:00:00.000Z");
  });
  it("prazo dentro do mesmo dia", () => {
    // quarta 10:00 local + 240 min = 14:00 local
    expect(addBusinessMinutes(at("2026-10-07T13:00:00Z"), 240, cal).toISOString()).toBe("2026-10-07T17:00:00.000Z");
  });
  it("atravessa noite, fim de semana e feriado", () => {
    // sexta 16:00 local + 240 min → 120 min na sexta; segunda é feriado; terça 11:00 local
    expect(addBusinessMinutes(at("2026-10-09T19:00:00Z"), 240, cal).toISOString()).toBe("2026-10-13T14:00:00.000Z");
  });
  it("abertura fora da janela começa no próximo início", () => {
    // quarta 20:00 local + 30 min → quinta 09:30
    expect(addBusinessMinutes(at("2026-10-07T23:00:00Z"), 30, cal).toISOString()).toBe("2026-10-08T12:30:00.000Z");
    // sábado → segunda é feriado → terça 09:30
    expect(addBusinessMinutes(at("2026-10-10T15:00:00Z"), 30, cal).toISOString()).toBe("2026-10-13T12:30:00.000Z");
  });
  it("conta minutos úteis entre instantes (inverso do prazo)", () => {
    const a = at("2026-10-09T19:00:00Z");
    const b = addBusinessMinutes(a, 777, cal);
    expect(businessMinutesBetween(a, b, cal)).toBe(777);
    expect(businessMinutesBetween(b, a, cal)).toBe(0);
    expect(businessMinutesBetween(at("2026-10-10T12:00:00Z"), at("2026-10-12T20:00:00Z"), cal)).toBe(0); // fim de semana + feriado
  });
  it("matriz impacto × urgência", () => {
    expect([priorityFrom(1, 1), priorityFrom(1, 2), priorityFrom(2, 2), priorityFrom(3, 2), priorityFrom(3, 3)]).toEqual(["P1", "P2", "P3", "P4", "P4"]);
  });
});

describe("banco de horas FIFO", () => {
  const credits = [
    { id: "ago", validFrom: "2026-08-01", expiresOn: "2026-10-31", remaining: "10" },
    { id: "set", validFrom: "2026-09-01", expiresOn: "2026-11-30", remaining: "80" },
    { id: "out", validFrom: "2026-10-01", expiresOn: "2026-12-31", remaining: "80" },
  ];
  it("consome primeiro o que vence antes e só créditos vigentes na data", () => {
    const r = consumeFifo(credits, "2026-09-15", "50");
    expect(r.allocations.map((a) => [a.creditId, a.hours.toString()])).toEqual([["ago", "10"], ["set", "40"]]);
    expect(r.overage.toString()).toBe("0");
  });
  it("gera excedente quando o saldo acaba e ignora créditos vencidos", () => {
    const r = consumeFifo(credits, "2026-11-10", "200");
    expect(r.allocations.map((a) => a.creditId)).toEqual(["set", "out"]);
    expect(r.overage.toString()).toBe("40");
  });
  it("vencimento da franquia por política", () => {
    expect(franchiseExpiry("2026-08-01", "NONE", null)).toBe("2026-08-31");
    expect(franchiseExpiry("2026-08-01", "ACCUMULATE", 3)).toBe("2026-11-30");
    expect(franchiseExpiry("2026-08-01", "PREPAID", null)).toBeNull();
  });
});
