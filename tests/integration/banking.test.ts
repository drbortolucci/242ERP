import { describe, expect, it, beforeAll } from "vitest";
import { newOrg, addUser } from "../helpers";
import { prisma } from "@/server/db";
import { createCompany } from "@/modules/companies/service";
import { createParty } from "@/modules/parties/service";
import { createManualTitle } from "@/modules/finance/service";
import { importStatement } from "@/modules/finance/treasury";
import { issueCharge, cancelCharge, simulatePayment, handleBankingWebhook, autoReconcile, saveReconciliationRule } from "@/modules/banking/service";
import { hmacSha256 } from "@/server/auth/crypto";

const company = { kind: "HEADQUARTERS" as const, legalName: "Serviços Cobrança Ltda", cnpj: "11222333000181", currency: "BRL", timezone: "America/Sao_Paulo" };
const SECRET = "segredo-de-teste-do-webhook-bancario";

beforeAll(() => { process.env.BANKING_WEBHOOK_SECRET = SECRET; });

async function setup() {
  const { ctx, org } = await newOrg();
  const c = await createCompany(ctx, company);
  const bank = await prisma.bankAccount.create({ data: { organizationId: org.id, companyId: c.id, name: "Conta cobrança", openingBalance: 0, openingDate: new Date("2026-01-01") } });
  const cust = await createParty(ctx, { personType: "COMPANY", name: "Cliente Pagador S.A.", document: "11444777000161", isCustomer: true, isSupplier: false, isProspect: false, isPartner: false });
  const fin = await addUser(org.id, ["finance"]);
  const r = await createManualTitle(fin, { kind: "RECEIVABLE", companyId: c.id, partyId: cust.id, description: "Mensalidade de suporte", issueDate: "2026-10-01", dueDate: "2099-10-31", competence: "2026-10-01", amount: "1000" });
  return { ctx, org, c, bank, cust, fin, r };
}

describe("cobrança bancária (provedor simulado)", () => {
  it("emite boleto, impede duplicidade, baixa por pagamento simulado com juros e conciliação do extrato", async () => {
    const { fin, r, bank } = await setup();
    const ch = await issueCharge(fin, { receivableId: r.id, method: "BOLETO", bankAccountId: bank.id, finePct: "2", interestPctMonth: "1" });
    expect(ch.status).toBe("REGISTERED");
    expect(ch.environment).toBe("SIMULATED");
    expect(ch.digitableLine).toMatch(/^SIMULADO/);
    await expect(issueCharge(fin, { receivableId: r.id, method: "PIX", bankAccountId: bank.id })).rejects.toThrow(/já existe cobrança/i);
    // pagamento com juros: principal = saldo, excedente = juros
    await simulatePayment(fin, ch.id, "1012.50", "2026-10-31");
    const paid = await prisma.bankCharge.findUniqueOrThrow({ where: { id: ch.id } });
    expect(paid.status).toBe("PAID");
    const s = await prisma.settlement.findUniqueOrThrow({ where: { id: paid.settlementId! } });
    expect(s.principal.toString()).toBe("1000");
    expect(s.interest.toString()).toBe("12.5");
    expect(s.total.toString()).toBe("1012.5");
    expect((await prisma.receivable.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PAID");
    // repetição do aviso não liquida de novo
    await simulatePayment(fin, ch.id).catch(() => undefined);
    expect(await prisma.settlement.count({ where: { receivableId: r.id } })).toBe(1);

    // extrato: crédito do boleto + tarifa; conciliação automática por valor/data e por regra
    await importStatement(fin, bank.id, "extrato.csv", "data;descricao;valor\n31/10/2026;LIQUIDACAO BOLETO;1012,50\n31/10/2026;TARIFA COBRANCA;-3,50\n01/11/2026;PIX RECEBIDO DESCONHECIDO;77,00");
    await saveReconciliationRule(fin, { name: "Tarifas", contains: "tarifa", direction: "OUT", description: "Tarifa bancária de cobrança", active: true });
    const ar = await autoReconcile(fin, bank.id);
    expect(ar).toEqual({ pending: 3, matched: 1, byRule: 1, remaining: 1 });
    const fee = await prisma.bankTransaction.findFirstOrThrow({ where: { bankAccountId: bank.id, kind: "FEE" } });
    expect(fee.amount.toString()).toBe("-3.5");
  });

  it("webhook exige assinatura, é idempotente, trata pagamento parcial e cobrança cancelada", async () => {
    const { fin, r, bank, org } = await setup();
    const ch = await issueCharge(fin, { receivableId: r.id, method: "PIX", bankAccountId: bank.id });
    expect(ch.pixCode).toMatch(/^SIMULADO\|PIX/);
    const body = JSON.stringify({ externalId: ch.externalId, type: "PAID", paidAmount: "400", paidAt: "2026-10-15" });
    expect((await handleBankingWebhook("simulated", body, "assinatura-falsa")).status).toBe(401);
    expect((await handleBankingWebhook("simulated", body, null)).status).toBe(401);
    expect((await handleBankingWebhook("outro", body, hmacSha256(SECRET, body))).status).toBe(404);
    const ok = await handleBankingWebhook("simulated", body, hmacSha256(SECRET, body));
    expect(ok.status).toBe(200);
    const dup = await handleBankingWebhook("simulated", body, hmacSha256(SECRET, body));
    expect(dup).toMatchObject({ ok: true, duplicate: true });
    const rec = await prisma.receivable.findUniqueOrThrow({ where: { id: r.id } });
    expect(rec.status).toBe("PARTIAL");
    expect(rec.openAmount.toString()).toBe("600");
    // nova cobrança do saldo; cancelada antes do pagamento → pagamento posterior fica para tratamento manual
    const ch2 = await issueCharge(fin, { receivableId: r.id, method: "BOLETO", bankAccountId: bank.id });
    expect(ch2.amount.toString()).toBe("600");
    await cancelCharge(fin, ch2.id, "Cliente pediu outra forma de pagamento");
    const late = JSON.stringify({ externalId: ch2.externalId, type: "PAID", paidAmount: "600", paidAt: "2026-10-20" });
    const lr = await handleBankingWebhook("simulated", late, hmacSha256(SECRET, late));
    expect(lr).toMatchObject({ ok: true, applied: false });
    expect((await prisma.receivable.findUniqueOrThrow({ where: { id: r.id } })).openAmount.toString()).toBe("600");
    expect((await prisma.bankCharge.findUniqueOrThrow({ where: { id: ch2.id } })).lastError).toMatch(/tratar manualmente/);
    // eventos registrados e isolamento por organização
    expect(await prisma.bankChargeEvent.count({ where: { organizationId: org.id } })).toBeGreaterThanOrEqual(5);
    const other = await newOrg();
    expect(await other.ctx.db.bankCharge.count()).toBe(0);
  });

  it("valida pagador, conta e permissões", async () => {
    const { fin, r, bank, org, c, ctx } = await setup();
    const noDoc = await createParty(ctx, { personType: "COMPANY", name: "Sem documento", isCustomer: true, isSupplier: false, isProspect: false, isPartner: false });
    const r2 = await createManualTitle(fin, { kind: "RECEIVABLE", companyId: c.id, partyId: noDoc.id, description: "Serviço avulso", issueDate: "2026-10-01", dueDate: "2099-10-31", competence: "2026-10-01", amount: "50" });
    await expect(issueCharge(fin, { receivableId: r2.id, method: "BOLETO", bankAccountId: bank.id })).rejects.toThrow(/CPF\/CNPJ/);
    const other = await prisma.company.create({ data: { organizationId: org.id, kind: "HEADQUARTERS", legalName: "Outra", cnpj: "11444777000161" } });
    const bank2 = await prisma.bankAccount.create({ data: { organizationId: org.id, companyId: other.id, name: "Outra conta", openingBalance: 0, openingDate: new Date("2026-01-01") } });
    await expect(issueCharge(fin, { receivableId: r.id, method: "BOLETO", bankAccountId: bank2.id })).rejects.toThrow(/Conta bancária inválida/);
    await expect(issueCharge(fin, { receivableId: r.id, method: "BOLETO", bankAccountId: bank.id, finePct: "50" })).rejects.toThrow(/Multa/);
    const seller = await addUser(org.id, ["sales"]);
    await expect(issueCharge(seller, { receivableId: r.id, method: "BOLETO", bankAccountId: bank.id })).rejects.toThrow(/Permissão/);
  });
});
