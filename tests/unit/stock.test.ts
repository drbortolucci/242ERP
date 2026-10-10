import { describe, expect, it } from "vitest";
import { applyInbound, applyOutbound, applyOutboundAtCost, countDifference, emptyPosition, lineTotals } from "@/domain/stock";

describe("custo médio móvel", () => {
  it("entradas recalculam o custo médio; saídas usam o médio vigente", () => {
    const a = applyInbound(emptyPosition(), 10, "5.00");
    expect(a.after.quantity.toString()).toBe("10");
    expect(a.after.value.toString()).toBe("50");
    const b = applyInbound(a.after, 10, "7.00");
    expect(b.after.avgCost.toString()).toBe("6");
    expect(b.after.value.toString()).toBe("120");
    const c = applyOutbound(b.after, 4);
    expect(c.totalCost.toString()).toBe("-24");
    expect(c.after.quantity.toString()).toBe("16");
    expect(c.after.value.toString()).toBe("96");
    expect(c.after.avgCost.toString()).toBe("6");
  });
  it("saída que zera o saldo leva exatamente o valor remanescente (sem resíduo de centavos)", () => {
    const a = applyInbound(emptyPosition(), 3, "10.00"); // 30,00
    const b = applyInbound(a.after, 1, "10.01"); // 40,01 → médio 10,0025
    const c = applyOutbound(b.after, 1); // 10,00 (arredondado)
    const d = applyOutbound(c.after, 3); // zera: leva o restante exato
    expect(c.totalCost.toString()).toBe("-10");
    expect(d.totalCost.toString()).toBe("-30.01");
    expect(d.after.value.toString()).toBe("0");
  });
  it("bloqueia saldo negativo, salvo depósito que permite", () => {
    const a = applyInbound(emptyPosition(), 2, 3);
    expect(() => applyOutbound(a.after, 3)).toThrow(/Saldo insuficiente/);
    expect(applyOutbound(a.after, 3, true).after.quantity.toString()).toBe("-1");
  });
  it("estorno de entrada retira exatamente o que entrou", () => {
    const a = applyInbound(emptyPosition(), 10, 5);
    const b = applyInbound(a.after, 10, 7);
    const r = applyOutboundAtCost(b.after, 10, b.totalCost);
    expect(r.after.quantity.toString()).toBe("10");
    expect(r.after.value.toString()).toBe("50");
    expect(r.after.avgCost.toString()).toBe("5");
  });
  it("valida quantidades e custos", () => {
    expect(() => applyInbound(emptyPosition(), 0, 1)).toThrow();
    expect(() => applyInbound(emptyPosition(), 1, -1)).toThrow();
    expect(() => applyOutbound(emptyPosition(), 0)).toThrow();
  });
  it("diferença de inventário e totais de linha", () => {
    expect(countDifference(10, 8).toString()).toBe("-2");
    expect(countDifference("1.5", 2).toString()).toBe("0.5");
    expect(lineTotals([{ quantity: 3, unitPrice: "3.333", discountAmount: "1" }]).map(String)).toEqual(["9"]);
    expect(() => lineTotals([{ quantity: 1, unitPrice: 1, discountAmount: 2 }])).toThrow();
  });
});
