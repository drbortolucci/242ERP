import { describe, expect, it } from "vitest";
import { priceProposal, splitInstallments } from "@/domain/pricing";

describe("precificação de propostas", () => {
  it("calcula receita, desconto, tributos, custos, margem de contribuição e markup com fórmulas distintas", () => {
    const t = priceProposal([
      { kind: "LABOR", hours: "100", unitPrice: "200", unitCost: "90" }, // 20.000 / 9.000
      { kind: "LABOR", hours: "40", unitPrice: "320", unitCost: "160" }, // 12.800 / 6.400
      { kind: "LICENSE", quantity: "2", unitPrice: "1500", unitCost: "1000" }, // 3.000 / 2.000
      { kind: "EXPENSE", quantity: "1", unitPrice: "2000", unitCost: "2000" }, // 2.000 / 2.000
    ], "10", "14.25");
    expect(t.grossRevenue.toFixed(2)).toBe("37800.00");
    expect(t.discountAmount.toFixed(2)).toBe("3780.00");
    expect(t.netRevenue.toFixed(2)).toBe("34020.00");
    expect(t.taxAmount.toFixed(2)).toBe("4847.85");
    expect(t.laborCost.toFixed(2)).toBe("15400.00");
    expect(t.thirdPartyCost.toFixed(2)).toBe("2000.00");
    expect(t.expenseCost.toFixed(2)).toBe("2000.00");
    expect(t.totalCost.toFixed(2)).toBe("19400.00");
    expect(t.contributionMargin.toFixed(2)).toBe("9772.15"); // 34020 − 4847,85 − 19400
    expect(t.marginPct!.toFixed(2)).toBe("28.72");
    expect(t.markup!.toFixed(2)).toBe("75.36"); // (34020 − 19400) / 19400
    expect(t.totalHours.toString()).toBe("140");
  });
  it("linhas não faturáveis geram custo sem receita; receita zero → margem indefinida", () => {
    const t = priceProposal([{ kind: "LABOR", hours: "10", unitPrice: "100", unitCost: "50", billable: false }]);
    expect(t.netRevenue.toFixed(2)).toBe("0.00");
    expect(t.totalCost.toFixed(2)).toBe("500.00");
    expect(t.marginPct).toBeNull();
  });
  it("recusa desconto inválido e valores negativos", () => {
    expect(() => priceProposal([], "101")).toThrow();
    expect(() => priceProposal([{ kind: "FIXED", quantity: "-1", unitPrice: "10" }])).toThrow();
  });
  it("parcela com soma exata", () => {
    const p = splitInstallments("1000.00", [{ days: 30, percent: "33.33" }, { days: 60, percent: "33.33" }, { days: 90, percent: "33.34" }]);
    expect(p.map((x) => x.amount.toFixed(2))).toEqual(["333.30", "333.30", "333.40"]);
    const q = splitInstallments("100.01", [{ days: 30, percent: "50" }, { days: 60, percent: "50" }]);
    expect(q.map((x) => x.amount.toFixed(2))).toEqual(["50.01", "50.00"]);
  });
});
