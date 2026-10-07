import { describe, expect, it } from "vitest";
import { computeWithholdings, receivableInstallments, settlementTotal, agingBucket } from "@/domain/billing";
import { parseStatement } from "@/domain/statement";

describe("faturamento (domínio)", () => {
  it("aplica apenas regras vigentes e acima da base mínima (regras fictícias de teste)", () => {
    const rules = [
      { code: "A", name: "Regra A", ratePct: "1.5", minBaseAmount: "100", validFrom: "2026-01-01", validTo: null },
      { code: "B", name: "Regra B", ratePct: "4.65", minBaseAmount: "10000", validFrom: "2026-01-01", validTo: null },
      { code: "C", name: "Expirada", ratePct: "1", minBaseAmount: null, validFrom: "2025-01-01", validTo: "2025-12-31" },
    ];
    const r = computeWithholdings("1000.01", rules, "2026-10-01");
    expect([r.lines.map((l) => l.code), r.total.toString(), r.net.toString()]).toEqual([["A"], "15", "985.01"]);
  });
  it("parcelas somam exatamente o líquido", () => {
    const p = receivableInstallments("1000", "2026-10-01", [{ days: 30, percent: "33.33" }, { days: 60, percent: "33.33" }, { days: 90, percent: "33.34" }], 30);
    expect(p.map((x) => x.amount.toString())).toEqual(["333.3", "333.3", "333.4"]);
    expect(p[2].dueDate).toBe("2026-12-30");
    expect(() => receivableInstallments("1000", "2026-10-01", [{ days: 30, percent: "90" }], 30)).toThrow(/100%/);
    expect(receivableInstallments("10", "2026-10-01", null, 15)[0].dueDate).toBe("2026-10-16");
  });
  it("total da liquidação e faixas de vencimento", () => {
    expect(settlementTotal("1000", "12.5", "20", "5").toString()).toBe("1027.5");
    expect([agingBucket("2026-10-10", "2026-10-07"), agingBucket("2026-09-30", "2026-10-07"), agingBucket("2026-06-01", "2026-10-07")]).toEqual(["A_VENCER", "1_30", "90_MAIS"]);
  });
});

describe("extrato bancário", () => {
  it("lê CSV com vírgula decimal e gera ids determinísticos (inclusive lançamentos iguais no mesmo dia)", () => {
    const csv = "Data;Descrição;Valor\n01/10/2026;TARIFA;-12,90\n01/10/2026;TARIFA;-12,90\n2026-10-02;PIX RECEBIDO;1.234,56\n";
    const a = parseStatement("x.csv", csv);
    expect(a.map((l) => [l.date, l.amount])).toEqual([["2026-10-01", "-12.90"], ["2026-10-01", "-12.90"], ["2026-10-02", "1234.56"]]);
    expect(a[0].externalId).not.toBe(a[1].externalId);
    expect(parseStatement("x.csv", csv).map((l) => l.externalId)).toEqual(a.map((l) => l.externalId));
  });
  it("lê OFX usando FITID", () => {
    const ofx = "<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261005120000<TRNAMT>1500.00<FITID>ABC1<MEMO>TED CLIENTE</STMTTRN><STMTTRN><DTPOSTED>20261006<TRNAMT>-9.90<FITID>ABC2<NAME>TARIFA</STMTTRN></BANKTRANLIST></OFX>";
    expect(parseStatement("e.ofx", ofx)).toEqual([{ externalId: "ABC1", date: "2026-10-05", amount: "1500.00", description: "TED CLIENTE" }, { externalId: "ABC2", date: "2026-10-06", amount: "-9.90", description: "TARIFA" }]);
  });
  it("recusa valores inválidos", () => {
    expect(() => parseStatement("x.csv", "01/10/2026;X;abc")).toThrow(/Valor inválido/);
  });
});
