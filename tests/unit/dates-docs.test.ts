import { describe, expect, it } from "vitest";
import { addMonths, civil, isCivilDate, monthEnd, monthsBetween, toCivil, todayIn, zonedToInstant, zonedParts } from "@/lib/dates";
import { cnpjFromBase, isValidCnpj, isValidCpf } from "@/lib/documents";
import { totpAt, verifyTotp, generateTotpSecret } from "@/server/auth/totp";

describe("datas civis", () => {
  it("valida e converte sem deslocamento de fuso", () => {
    expect(isCivilDate("2026-02-29")).toBe(false);
    expect(isCivilDate("2028-02-29")).toBe(true);
    expect(toCivil(civil("2026-10-06"))).toBe("2026-10-06");
  });
  it("soma meses respeitando fim de mês", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 2)).toBe("2027-02-15");
    expect(monthEnd("2026-02-10")).toBe("2026-02-28");
    expect(monthsBetween("2026-01-15", "2026-04-02")).toEqual(["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"]);
  });
  it("data de hoje depende do fuso (instante UTC vs data civil)", () => {
    const instant = new Date("2026-10-07T01:30:00Z"); // 22:30 de 06/10 em São Paulo
    expect(todayIn("America/Sao_Paulo", instant)).toBe("2026-10-06");
    expect(todayIn("UTC", instant)).toBe("2026-10-07");
  });
  it("converte horário local em instante UTC", () => {
    const i = zonedToInstant("2026-10-06", 9 * 60, "America/Sao_Paulo");
    expect(i.toISOString()).toBe("2026-10-06T12:00:00.000Z");
    expect(zonedParts(i, "America/Sao_Paulo").minuteOfDay).toBe(540);
  });
});

describe("documentos", () => {
  it("valida CNPJ por dígitos verificadores", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCnpj(cnpjFromBase("123456780001"))).toBe(true);
  });
  it("valida CPF", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("529.982.247-24")).toBe(false);
  });
});

describe("TOTP", () => {
  it("gera e valida códigos com tolerância de uma janela", () => {
    const s = generateTotpSecret();
    const now = Date.now();
    expect(verifyTotp(s, totpAt(s, now), now)).toBe(true);
    expect(verifyTotp(s, totpAt(s, now - 30000), now)).toBe(true);
    expect(verifyTotp(s, totpAt(s, now - 120000), now)).toBe(false);
  });
  it("confere vetor RFC 6238 (SHA1)", () => {
    // segredo ASCII "12345678901234567890" em base32
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(totpAt(secret, 59000)).toBe("287082");
  });
});
