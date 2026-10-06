import { describe, expect, it } from "vitest";
import { matchRules } from "@/modules/approvals/service";
import { sniffFile } from "@/modules/attachments/sniff";
import { parseCsv } from "@/modules/imports/service";

const rule = (o: Partial<{ id: string; companyId: string | null; name: string; minAmount: string | null; maxDiscountPct: string | null; minMarginPct: string | null; requiredPermission: string; level: number }>) => ({
  id: "r", companyId: null, name: "Regra", minAmount: null, maxDiscountPct: null, minMarginPct: null, requiredPermission: "proposal.approve", level: 1, ...o,
});

describe("alçadas", () => {
  const rules = [
    rule({ id: "d", name: "Desconto", maxDiscountPct: "10" }),
    rule({ id: "m", name: "Margem", minMarginPct: "25" }),
    rule({ id: "v", name: "Valor alto", minAmount: "500000", requiredPermission: "proposal.approve_high", level: 2 }),
    rule({ id: "c", name: "Só empresa X", minAmount: "0", companyId: "X" }),
  ];
  it("não exige aprovação dentro dos limites", () => {
    expect(matchRules(rules, { companyId: "Y", amount: "100000", discountPct: "5", marginPct: "30" })).toHaveLength(0);
  });
  it("exige por desconto, margem e valor, ordenando por nível", () => {
    const m = matchRules(rules, { companyId: "Y", amount: "600000", discountPct: "12", marginPct: "20" });
    expect(m.map((x) => x.ruleId)).toEqual(["d", "m", "v"]);
    expect(m[2].requiredPermission).toBe("proposal.approve_high");
  });
  it("limite exato de desconto não dispara (regra é 'acima de')", () => {
    expect(matchRules(rules, { companyId: "Y", amount: "1", discountPct: "10", marginPct: "25" })).toHaveLength(0);
  });
  it("regra por empresa só vale para a empresa", () => {
    expect(matchRules(rules, { companyId: "X", amount: "1", discountPct: "0", marginPct: "50" }).map((x) => x.ruleId)).toEqual(["c"]);
  });
});

describe("validação de anexos pelo conteúdo", () => {
  it("aceita PDF real e recusa executável renomeado", () => {
    expect(sniffFile(Buffer.from("%PDF-1.7\n..."), "a.pdf")?.mime).toBe("application/pdf");
    expect(sniffFile(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), "nota.pdf")).toBeNull();
  });
  it("recusa HTML/SVG disfarçado de texto", () => {
    expect(sniffFile(Buffer.from("<svg onload=alert(1)>"), "x.svg")).toBeNull();
    expect(sniffFile(Buffer.from("<html></html>"), "x.html")).toBeNull();
    expect(sniffFile(Buffer.from("a;b\n1;2"), "x.csv")?.mime).toBe("text/csv");
  });
});

describe("CSV", () => {
  it("interpreta ; e aspas", () => {
    expect(parseCsv('nome;obs\n"ACME; Ltda";"diz ""olá"""\n')).toEqual([["nome", "obs"], ["ACME; Ltda", 'diz "olá"']]);
  });
});
