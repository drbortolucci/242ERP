import { describe, expect, it } from "vitest";
import { allocate, dec, money, parseMoneyInput, pct, sum, formatMoney } from "@/lib/money";

describe("money", () => {
  it("evita erro de ponto flutuante", () => {
    expect(sum(["0.1", "0.2"]).toString()).toBe("0.3");
    expect(money(dec("1.005")).toFixed(2)).toBe("1.01"); // HALF_UP
    expect(money("2.675").toFixed(2)).toBe("2.68");
    expect(money("-1.005").toFixed(2)).toBe("-1.01");
  });
  it("rateia sem perder centavos", () => {
    const parts = allocate("100.00", [1, 1, 1]);
    expect(parts.map((p) => p.toFixed(2))).toEqual(["33.33", "33.33", "33.34"]);
    expect(sum(parts).toFixed(2)).toBe("100.00");
    const p2 = allocate("1000", ["33.3333", "33.3333", "33.3334"]);
    expect(sum(p2).toFixed(2)).toBe("1000.00");
  });
  it("calcula percentual e trata divisão por zero", () => {
    expect(pct(25, 200)!.toString()).toBe("12.5");
    expect(pct(1, 0)).toBeNull();
  });
  it("interpreta entrada pt-BR", () => {
    expect(parseMoneyInput("1.234,56").toString()).toBe("1234.56");
    expect(parseMoneyInput("R$ 10,5").toString()).toBe("10.5");
    expect(parseMoneyInput("99.90").toString()).toBe("99.9");
    expect(() => parseMoneyInput("abc")).toThrow();
  });
  it("formata BRL", () => {
    expect(formatMoney("1234.5").replace(/\s/g, " ")).toContain("1.234,50");
  });
});
