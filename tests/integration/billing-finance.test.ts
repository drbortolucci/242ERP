import { describe, expect, it } from "vitest";
import { newOrg, addUser } from "../helpers";
import { prisma } from "@/server/db";
import "@/modules/approvals/register-all";
import { dec } from "@/lib/money";
import { createCompany } from "@/modules/companies/service";
import { createParty } from "@/modules/parties/service";
import { decide } from "@/modules/approvals/service";
import { billingCandidates, createMeasurement, submitMeasurement, cancelMeasurement } from "@/modules/billing/measurement";
import { invoiceMeasurement, cancelBillingDocument } from "@/modules/billing/invoice";
import { requestFiscalDocument, processFiscalDocument, handleFiscalWebhook } from "@/modules/billing/fiscal";
import { settle, reverseSettlement, registerAdvance, applyAdvance, createManualTitle, approvePayable, offsetTitles, aging } from "@/modules/finance/service";
import { importStatement, reconcile, suggestMatches, createFromLine, accountBalances, transfer, cashFlow } from "@/modules/finance/treasury";

const company = { kind: "HEADQUARTERS" as const, legalName: "Consultoria Fat Ltda", cnpj: "11222333000181", currency: "BRL", timezone: "America/Sao_Paulo" };

async function setup() {
  const o = await newOrg();
  const c = await createCompany(o.ctx, company);
  const party = await createParty(o.ctx, { personType: "COMPANY", name: "Cliente Fat S.A.", document: "11444777000161", isCustomer: true, isSupplier: true, isProspect: false, isPartner: false });
  const term = await prisma.paymentTerm.create({ data: { organizationId: o.org.id, name: "30/60", installments: [{ days: 30, percent: "50" }, { days: 60, percent: "50" }] } });
  const contract = await prisma.contract.create({ data: { organizationId: o.org.id, companyId: c.id, number: "CTR-F1", partyId: party.id, title: "T&M", commercialModel: "TIME_MATERIAL", status: "ACTIVE", startDate: new Date("2026-01-01"), totalValue: 100000, paymentTermId: term.id, requiresPo: true } });
  await prisma.customerPurchaseOrder.create({ data: { organizationId: o.org.id, contractId: contract.id, number: "OC-77", amount: 10000 } });
  const prof = await prisma.professional.create({ data: { organizationId: o.org.id, companyId: c.id, name: "Consultor", employmentType: "CLT", certifications: [] } });
  const te = (date: string) => prisma.timeEntry.create({ data: { organizationId: o.org.id, companyId: c.id, professionalId: prof.id, contractId: contract.id, date: new Date(date), hours: 10, description: "Desenvolvimento", status: "APPROVED", billingStatus: "ELIGIBLE", sellRate: 200, createdById: o.user.id } });
  const entries = [await te("2026-09-02"), await te("2026-09-03"), await te("2026-09-04")];
  await prisma.contractMilestone.create({ data: { organizationId: o.org.id, contractId: contract.id, name: "Entrega do desenho", amount: 1000, status: "ACCEPTED" } });
  const cat = await prisma.expenseCategory.findFirstOrThrow({ where: { organizationId: o.org.id } });
  await prisma.expense.create({ data: { organizationId: o.org.id, companyId: c.id, date: new Date("2026-09-05"), categoryId: cat.id, description: "Hotel", amount: 300, billableToClient: true, billableAmount: 300, contractId: contract.id, status: "APPROVED", billingStatus: "ELIGIBLE", createdById: o.user.id } });
  // Regra de retenção FICTÍCIA, apenas para teste (o sistema não define alíquotas)
  await prisma.withholdingRule.create({ data: { organizationId: o.org.id, companyId: c.id, code: "TESTE", name: "Retenção de teste", ratePct: 1.5, minBaseAmount: 100, validFrom: new Date("2026-01-01") } });
  const bank = await prisma.bankAccount.create({ data: { organizationId: o.org.id, companyId: c.id, name: "Banco A", openingBalance: 1000, openingDate: new Date("2026-01-01") } });
  const bank2 = await prisma.bankAccount.create({ data: { organizationId: o.org.id, companyId: c.id, name: "Banco B", openingBalance: 0, openingDate: new Date("2026-01-01") } });
  const fin = await addUser(o.org.id, ["finance"]);
  const fin2 = await addUser(o.org.id, ["finance"]);
  const director = await addUser(o.org.id, ["director"]);
  return { ...o, c, party, contract, entries, bank, bank2, fin, fin2, director };
}

describe("medição com origem rastreável e faturamento parcial sem duplicidade", () => {
  it("mede, trava, aprova (SoD), fatura parcialmente com retenção configurada, OC e parcelas exatas; idempotência e cancelamento", async () => {
    const { org, contract, entries, fin, fin2 } = await setup();
    const cands = await billingCandidates(fin, contract.id, "2026-09-01", "2026-09-30");
    expect(cands.map((x) => x.sourceType).sort()).toEqual(["EXPENSE", "MILESTONE", "TIME_ENTRY", "TIME_ENTRY", "TIME_ENTRY"]);
    // duas medições simultâneas das mesmas origens: só uma vence a trava
    const both = await Promise.allSettled([createMeasurement(fin, { contractId: contract.id, periodStart: "2026-09-01", periodEnd: "2026-09-30", competence: "2026-09-01" }), createMeasurement(fin, { contractId: contract.id, periodStart: "2026-09-01", periodEnd: "2026-09-30", competence: "2026-09-01" })]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const m = (both.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof createMeasurement>>>).value;
    expect(m.totalAmount.toString()).toBe("7300");
    expect(await prisma.billingLock.count({ where: { organizationId: org.id } })).toBe(5);
    await expect(createMeasurement(fin, { contractId: contract.id, periodStart: "2026-09-01", periodEnd: "2026-09-30", competence: "2026-09-01" })).rejects.toThrow(/Nenhum item/);
    expect((await prisma.measurementItem.findMany({ where: { measurementId: m.id } })).every((i) => i.sourceId)).toBe(true);
    // aprovação: quem mediu não aprova
    expect(await submitMeasurement(fin, m.id)).toBe(false);
    const ar = await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: m.id, status: "PENDING" } });
    await expect(decide(fin, ar.id, true)).rejects.toThrow();
    await decide(fin2, ar.id, true);
    expect((await prisma.measurement.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("APPROVED");
    // faturamento parcial: duas horas (4.000)
    const items = await prisma.measurementItem.findMany({ where: { measurementId: m.id, sourceType: "TIME_ENTRY" }, orderBy: { description: "asc" } });
    const part = { measurementId: m.id, issueDate: "2026-10-01", idempotencyKey: "fat-0001-aaaa", itemIds: [items[0].id, items[1].id], discountAmount: "0" };
    const d1 = await invoiceMeasurement(fin, part);
    expect([d1.grossAmount.toString(), d1.withholdingAmount.toString(), d1.netAmount.toString(), d1.customerPo]).toEqual(["4000", "60", "3940", "OC-77"]);
    expect((await invoiceMeasurement(fin, part)).id).toBe(d1.id); // mesma chave → mesmo documento
    await expect(invoiceMeasurement(fin, { ...part, idempotencyKey: "fat-0002-bbbb" })).rejects.toThrow(/já foram faturados/);
    const recs = await prisma.receivable.findMany({ where: { billingDocumentId: d1.id }, orderBy: { installment: "asc" } });
    expect(recs.map((r) => [r.amount.toString(), r.dueDate.toISOString().slice(0, 10)])).toEqual([["1970", "2026-10-31"], ["1970", "2026-11-30"]]);
    expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: items[0].sourceId! } })).billingStatus).toBe("INVOICED");
    expect((await prisma.measurement.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("PARTIALLY_INVOICED");
    // OC: saldo 10.000 − 4.000; restante 3.300 cabe; cancelamento devolve itens à medição
    const d2 = await invoiceMeasurement(fin, { measurementId: m.id, issueDate: "2026-10-02", idempotencyKey: "fat-0003-cccc", discountAmount: "100" });
    expect([d2.grossAmount.toString(), (await prisma.measurement.findUniqueOrThrow({ where: { id: m.id } })).status]).toEqual(["3200", "INVOICED"]);
    await expect(cancelMeasurement(fin, m.id, "x")).rejects.toThrow();
    await cancelBillingDocument(fin, d2.id, "Cliente pediu separar a despesa");
    expect((await prisma.measurement.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("PARTIALLY_INVOICED");
    expect(await prisma.measurementItem.count({ where: { measurementId: m.id, status: "ACTIVE" } })).toBe(3);
    expect((await prisma.receivable.findMany({ where: { billingDocumentId: d2.id } })).every((r) => r.status === "CANCELED")).toBe(true);
    void entries;
  });
});

describe("financeiro e tesouraria", () => {
  it("liquidação parcial com juros, idempotência, estorno vinculado, adiantamento, compensação, aging, extrato e conciliação", async () => {
    const { ctx, c, party, contract, bank, bank2, fin, fin2 } = await setup();
    const m = await createMeasurement(fin, { contractId: contract.id, periodStart: "2026-09-01", periodEnd: "2026-09-30", competence: "2026-09-01" });
    await submitMeasurement(fin, m.id);
    await decide(fin2, (await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: m.id, status: "PENDING" } })).id, true);
    const doc = await invoiceMeasurement(fin, { measurementId: m.id, issueDate: "2026-10-01", idempotencyKey: "fat-fin-0001", discountAmount: "0" });
    const [r1, r2] = await prisma.receivable.findMany({ where: { billingDocumentId: doc.id }, orderBy: { installment: "asc" } });
    // recebimento parcial: principal 1.000 + juros 10
    const s = await settle(fin, { kind: "RECEIVABLE", titleId: r1.id, date: "2026-10-05", principal: "1000", interest: "10", fine: "0", discount: "0", bankAccountId: bank.id, idempotencyKey: "rcv-0001-xxxx" });
    expect((await settle(fin, { kind: "RECEIVABLE", titleId: r1.id, date: "2026-10-05", principal: "1000", interest: "10", fine: "0", discount: "0", bankAccountId: bank.id, idempotencyKey: "rcv-0001-xxxx" })).id).toBe(s.id);
    let t = await prisma.receivable.findUniqueOrThrow({ where: { id: r1.id } });
    expect([t.status, t.openAmount.toString()]).toEqual(["PARTIAL", dec(r1.amount).minus(1000).toString()]);
    await expect(settle(fin, { kind: "RECEIVABLE", titleId: r1.id, date: "2026-10-05", principal: "999999", interest: "0", fine: "0", discount: "0", bankAccountId: bank.id, idempotencyKey: "rcv-0002-xxxx" })).rejects.toThrow(/acima do saldo/);
    // estorno: registro inverso vinculado e saldo restaurado; não estorna duas vezes
    const rev = await reverseSettlement(fin, s.id, "Cheque devolvido", "2026-10-06");
    expect([rev.reversalOfId, rev.total.toString()]).toEqual([s.id, "-1010"]);
    expect((await prisma.settlement.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("REVERSED");
    t = await prisma.receivable.findUniqueOrThrow({ where: { id: r1.id } });
    expect([t.status, t.openAmount.toString()]).toEqual(["OPEN", r1.amount.toString()]);
    await expect(reverseSettlement(fin, s.id, "de novo")).rejects.toThrow();
    // adiantamento do cliente aplicado ao título
    const adv = await registerAdvance(fin, { direction: "CUSTOMER", companyId: c.id, partyId: party.id, amount: "500", date: "2026-10-02", bankAccountId: bank.id });
    await applyAdvance(fin, adv.id, r2.id, "500");
    expect((await prisma.billingDocument.findUniqueOrThrow({ where: { id: doc.id } })).advanceApplied.toString()).toBe("500");
    await expect(applyAdvance(fin, adv.id, r2.id, "1")).rejects.toThrow(/sem saldo/);
    // compensação com conta a pagar da mesma parte (aprovação com SoD)
    const pay = await createManualTitle(ctx, { kind: "PAYABLE", companyId: c.id, partyId: party.id, description: "Serviço prestado pelo cliente", issueDate: "2026-10-01", dueDate: "2026-10-20", competence: "2026-10-01", amount: "300" });
    await expect(approvePayable(fin, pay.id)).rejects.toThrow(/payable.approve/);
    await expect(approvePayable(ctx, pay.id)).rejects.toThrow(/Segregação/);
    const dir = await addUser(ctx.orgId, ["director"]);
    await approvePayable(dir, pay.id);
    await expect(offsetTitles(fin, { receivableId: r2.id, payableId: pay.id, amount: "300", reason: "Encontro de contas acordado" })).rejects.toThrow(); // financeiro sem offset.approve
    const admin = ctx;
    await offsetTitles(admin, { receivableId: r2.id, payableId: pay.id, amount: "300", reason: "Encontro de contas acordado" });
    expect((await prisma.payable.findUniqueOrThrow({ where: { id: pay.id } })).status).toBe("PAID");
    const ag = await aging(fin, "RECEIVABLE", "2026-12-15");
    expect(ag.total.toString()).toBe(dec(r1.amount).plus(r2.amount).minus(800).toString());
    // tesouraria: transferência, extrato (reimportação não duplica), conciliação 1:1 e tarifa
    const s2 = await settle(fin, { kind: "RECEIVABLE", titleId: r1.id, date: "2026-10-10", principal: "500", interest: "0", fine: "0", discount: "0", bankAccountId: bank.id, idempotencyKey: "rcv-0003-xxxx" });
    await transfer(fin, { fromAccountId: bank.id, toAccountId: bank2.id, date: "2026-10-11", amount: "200" });
    const csv = "data;descrição;valor\n10/10/2026;TED CLIENTE FAT;500,00\n11/10/2026;TARIFA PACOTE;-12,90\n";
    expect(await importStatement(fin, bank.id, "extrato.csv", csv)).toEqual({ imported: 2, duplicates: 0 });
    expect(await importStatement(fin, bank.id, "extrato.csv", csv)).toEqual({ imported: 0, duplicates: 2 });
    const lines = await prisma.bankStatementLine.findMany({ where: { bankAccountId: bank.id }, orderBy: { date: "asc" } });
    const sug = await suggestMatches(fin, lines[0].id);
    expect(sug[0].id).toBe(s2.bankTransactionId);
    await reconcile(fin, lines[0].id, sug[0].id);
    await expect(reconcile(fin, lines[0].id, sug[0].id)).rejects.toThrow(/já conciliad/);
    await createFromLine(fin, lines[1].id, "Tarifa bancária");
    const bal = (await accountBalances(fin, "2026-10-31")).find((b) => b.account.id === bank.id)!;
    // 1000 + 1010 − 1010 + 500 (adiant.) + 500 − 200 − 12,90
    expect([bal.balance.toString(), bal.pendingLines]).toEqual(["1787.1", 0]);
    const cf = await cashFlow(fin, "2026-10-01", "2026-12-31", c.id);
    expect(cf.opening.toString()).toBe("1000");
  });

  it("NFS-e simulada: rejeita sem código de serviço, autoriza após cadastro; webhook exige assinatura", async () => {
    const { org, c, contract, fin, fin2 } = await setup();
    const m = await createMeasurement(fin, { contractId: contract.id, periodStart: "2026-09-01", periodEnd: "2026-09-30", competence: "2026-09-01" });
    await submitMeasurement(fin, m.id);
    await decide(fin2, (await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: m.id, status: "PENDING" } })).id, true);
    const doc = await invoiceMeasurement(fin, { measurementId: m.id, issueDate: "2026-10-01", idempotencyKey: "fat-nfse-0001", discountAmount: "0" });
    const fd = await requestFiscalDocument(fin, doc.id);
    expect((await processFiscalDocument(fd.id))?.status).toBe("REJECTED");
    const svc = await prisma.service.findFirstOrThrow({ where: { organizationId: org.id } });
    await prisma.fiscalServiceCode.create({ data: { organizationId: org.id, companyId: c.id, serviceId: svc.id, municipalityCode: "0000000", serviceCode: "CODIGO-TESTE", validFrom: new Date("2026-01-01") } });
    const fd2 = await requestFiscalDocument(fin, doc.id);
    const done = await processFiscalDocument(fd2.id);
    expect([done?.status, done?.environment, done?.number?.startsWith("SIM-")]).toEqual(["AUTHORIZED", "SIMULATED", true]);
    expect((await prisma.billingDocument.findUniqueOrThrow({ where: { id: doc.id } })).fiscalStatus).toBe("AUTHORIZED");
    await expect(cancelBillingDocument(fin, doc.id, "teste")).rejects.toThrow(/NFS-e/);
    expect((await handleFiscalWebhook(JSON.stringify({ externalId: done?.externalId, status: "CANCELED" }), "assinatura-invalida")).status).toBe(401);
  });
});
