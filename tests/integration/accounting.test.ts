import { describe, expect, it } from "vitest";
import { newOrg, addUser } from "../helpers";
import { prisma } from "@/server/db";
import "@/modules/approvals/register-all";
import { createCompany } from "@/modules/companies/service";
import { createParty } from "@/modules/parties/service";
import { createManualTitle, settle, reverseSettlement, approvePayable, registerAdvance, applyAdvance } from "@/modules/finance/service";
import { transfer, importStatement, createFromLine } from "@/modules/finance/treasury";
import { saveProduct, saveWarehouse, postManualMovement } from "@/modules/inventory/service";
import { saveProductOrder, confirmProductOrder, deliverProductOrder } from "@/modules/inventory/orders";
import { syncJournal, trialBalance, balanceSheet, incomeStatement, createManualEntry, reverseEntry, accountLedger, journalCsv, saveMapping, saveLedgerAccount } from "@/modules/accounting/service";
import { dec } from "@/lib/money";
import { isBalanced, normalizeLines, invert } from "@/domain/journal";

const company = { kind: "HEADQUARTERS" as const, legalName: "Contábil Teste Ltda", cnpj: "11222333000181", currency: "BRL", timezone: "America/Sao_Paulo" };

describe("partidas dobradas (domínio)", () => {
  it("normaliza negativos, verifica equilíbrio e inverte", () => {
    const l = normalizeLines([{ account: "a", debit: -10 }, { account: "b", credit: -10 }, { account: "c", debit: 0 }]);
    expect(l.map((x) => [x.account, x.debit.toString(), x.credit.toString()])).toEqual([["a", "0", "10"], ["b", "10", "0"]]);
    expect(isBalanced(l)).toBe(true);
    expect(isBalanced(normalizeLines([{ account: "a", debit: 10 }, { account: "b", credit: 9.99 }]))).toBe(false);
    expect(invert(l)[0].debit.toString()).toBe("10");
  });
});

describe("contabilidade automática", () => {
  it("contabiliza vendas, compras, liquidações, estornos, banco, adiantamentos e estoque com balancete e balanço fechando", async () => {
    const { ctx, org } = await newOrg();
    const c = await createCompany(ctx, company);
    const bank = await prisma.bankAccount.create({ data: { organizationId: org.id, companyId: c.id, name: "Banco A", openingBalance: 1000, openingDate: new Date("2026-09-01") } });
    const bank2 = await prisma.bankAccount.create({ data: { organizationId: org.id, companyId: c.id, name: "Banco B", openingBalance: 0, openingDate: new Date("2026-09-01") } });
    const cust = await createParty(ctx, { personType: "COMPANY", name: "Cliente Contábil", document: "11444777000161", isCustomer: true, isSupplier: true, isProspect: false, isPartner: false });
    const fin = await addUser(org.id, ["finance"]);
    const dir = await addUser(org.id, ["director"]);
    const acct = await addUser(org.id, ["accountant"]);

    // Título avulso a receber 500, recebido com juros 10 e depois estornado parcialmente (estorno integral da liquidação)
    const r = await createManualTitle(fin, { kind: "RECEIVABLE", companyId: c.id, partyId: cust.id, description: "Consultoria avulsa", issueDate: "2026-09-02", dueDate: "2026-09-30", competence: "2026-09-02", amount: "500" });
    const s1 = await settle(fin, { kind: "RECEIVABLE", titleId: r.id, date: "2026-09-10", principal: "500", interest: "10", fine: "0", discount: "0", bankAccountId: bank.id, idempotencyKey: "acc-s1" });
    await reverseSettlement(fin, s1.id, "Cheque devolvido", "2026-09-11");
    await settle(fin, { kind: "RECEIVABLE", titleId: r.id, date: "2026-09-12", principal: "500", interest: "0", fine: "0", discount: "5", bankAccountId: bank.id, idempotencyKey: "acc-s2" });
    // Conta a pagar avulsa 200 aprovada e paga com desconto obtido de 4
    const p = await createManualTitle(fin, { kind: "PAYABLE", companyId: c.id, partyId: cust.id, description: "Aluguel", issueDate: "2026-09-03", dueDate: "2026-09-20", competence: "2026-09-03", amount: "200" });
    await approvePayable(dir, p.id);
    await settle(fin, { kind: "PAYABLE", titleId: p.id, date: "2026-09-15", principal: "200", interest: "0", fine: "0", discount: "4", bankAccountId: bank.id, idempotencyKey: "acc-s3" });
    // Transferência, tarifa e adiantamento de cliente aplicado em novo título
    await transfer(fin, { fromAccountId: bank.id, toAccountId: bank2.id, date: "2026-09-16", amount: "300" });
    await importStatement(fin, bank.id, "e.csv", "data;descricao;valor\n17/09/2026;TARIFA;-7,00");
    const line = await prisma.bankStatementLine.findFirstOrThrow({ where: { bankAccountId: bank.id } });
    await createFromLine(fin, line.id, "Tarifa bancária");
    const adv = await registerAdvance(fin, { direction: "CUSTOMER", companyId: c.id, partyId: cust.id, amount: "100", date: "2026-09-18", bankAccountId: bank2.id });
    const r2 = await createManualTitle(fin, { kind: "RECEIVABLE", companyId: c.id, partyId: cust.id, description: "Treinamento", issueDate: "2026-09-19", dueDate: "2026-10-19", competence: "2026-09-19", amount: "250" });
    await applyAdvance(fin, adv.id, r2.id, "100");
    // Estoque: saldo inicial e venda entregue (receita + CMV)
    const wh = await saveWarehouse(ctx, { companyId: c.id, code: "CD", name: "CD", allowNegative: false, active: true });
    const prod = await saveProduct(ctx, { code: "P1", name: "Produto", kind: "GOODS", unit: "UN", salePrice: "80", minStock: "0", tracksStock: true, active: true });
    await postManualMovement(ctx, { type: "OPENING", productId: prod.id, warehouseId: wh.id, date: "2026-09-01", quantity: "10", unitCost: "30", reason: "Implantação" });
    const o = await saveProductOrder(ctx, { companyId: c.id, partyId: cust.id, warehouseId: wh.id, orderDate: "2026-09-20", freightAmount: "0", lineProduct: [prod.id], lineQuantity: ["2"], linePrice: ["80"], lineDiscount: ["0"] });
    await confirmProductOrder(ctx, o.id);
    await deliverProductOrder(ctx, { id: o.id, date: "2026-09-21" });

    // permissões: financeiro não contabiliza
    await expect(syncJournal(fin, c.id, "2026-09-01")).rejects.toThrow(/Permissão/);
    const res = await syncJournal(acct, c.id, "2026-09-01");
    expect(res.skipped).toEqual([]);
    expect(res.posted).toBe(res.expected);
    expect((await syncJournal(acct, c.id, "2026-09-01")).posted).toBe(0); // idempotente
    // aplicação de adiantamento é datada quando aplicada (hoje): contabiliza o mês corrente também
    const today = new Date().toISOString().slice(0, 10);
    await syncJournal(acct, c.id, today);

    const tb = await trialBalance(acct, c.id, "2026-09-01", today);
    const leaf = tb.filter((x) => x.analytic);
    expect(leaf.reduce((a, x) => a.plus(x.debit), dec(0)).toString()).toBe(leaf.reduce((a, x) => a.plus(x.credit), dec(0)).toString());
    const by = (code: string) => tb.find((x) => x.code === code)!;
    // Bancos: 1000 + 510 − 510 + 495 − 196 − 7 + 100 (banco B: +300 −300 entre contas) = 1392
    expect(by("1.1.1.02").closing.toString()).toBe("1392");
    expect(by("1.1.2.01").closing.toString()).toBe("310"); // clientes: r2 250 − 100 + venda 160
    expect(by("2.1.1.03").closing.toString()).toBe("0"); // adiantamento aplicado
    expect(by("1.1.3.01").closing.toString()).toBe("240"); // estoque 300 − 60
    expect(by("4.1.01").closing.toString()).toBe("60"); // CMV
    expect(by("3.1.02").closing.toString()).toBe("160");
    expect(by("4.3.02").closing.toString()).toBe("5"); // desconto concedido
    expect(by("3.2.01").closing.toString()).toBe("4"); // juros estornados (0) + desconto obtido 4
    expect(by("4.3.01").closing.toString()).toBe("7"); // tarifa
    const bs = await balanceSheet(acct, c.id, today);
    expect(bs.balanced).toBe(true);
    const dre = await incomeStatement(acct, c.id, "2026-09-01", "2026-09-30");
    // receitas: 500 (outras) + 250 (outras) + 160 (mercadorias) + 4 financeiras = 914; despesas: 200 + 60 + 5 + 7 = 272
    expect(dre.totalRevenue.toString()).toBe("914");
    expect(dre.totalExpense.toString()).toBe("272");
    expect(dre.result.toString()).toBe("642");

    // de-para da conta bancária B para subconta própria
    const sub = await saveLedgerAccount(acct, { code: "1.1.1.03", name: "Banco B", nature: "ASSET", analytic: true, active: true });
    await saveMapping(acct, { sourceType: "BANK_ACCOUNT", sourceId: bank2.id, accountId: sub.id });
    await expect(saveLedgerAccount(acct, { code: "1.1.1.02.01", name: "Sub de analítica", nature: "ASSET", analytic: true, active: true })).rejects.toThrow(/analítica/);

    // lançamento manual: desbalanceado é recusado; balanceado entra e pode ser estornado
    const accs = await prisma.ledgerAccount.findMany({ where: { organizationId: org.id } });
    const id = (code: string) => accs.find((a) => a.code === code)!.id;
    await expect(createManualEntry(acct, { companyId: c.id, date: "2026-09-30", description: "Integralização", lineAccount: [id("1.1.1.01"), id("2.3.1")], lineDebit: ["1000", ""], lineCredit: ["", "999"], lineMemo: ["", ""] })).rejects.toThrow(/desbalanceado/);
    await expect(createManualEntry(acct, { companyId: c.id, date: "2026-09-30", description: "Sintética", lineAccount: [id("1.1.1"), id("2.3.1")], lineDebit: ["10", ""], lineCredit: ["", "10"], lineMemo: ["", ""] })).rejects.toThrow(/analíticas/);
    const je = await createManualEntry(acct, { companyId: c.id, date: "2026-09-30", description: "Integralização de capital", lineAccount: [id("1.1.1.01"), id("2.3.1")], lineDebit: ["1000", ""], lineCredit: ["", "1000"], lineMemo: ["", ""] });
    const rev = await reverseEntry(acct, je.id, "Lançado na empresa errada", "2026-09-30");
    expect(rev.reversalOfId).toBe(je.id);
    await expect(reverseEntry(acct, je.id, "de novo", "2026-09-30")).rejects.toThrow(/já estornado/);
    const auto = await prisma.journalEntry.findFirstOrThrow({ where: { organizationId: org.id, origin: "AUTO" } });
    await expect(reverseEntry(acct, auto.id, "teste", "2026-09-30")).rejects.toThrow(/operação de origem/);
    const led = await accountLedger(acct, id("1.1.1.01"), c.id, "2026-09-01", "2026-09-30");
    expect(led.closing.toString()).toBe("0");
    expect((await journalCsv(acct, c.id, "2026-09-01", "2026-09-30")).split("\n")[0]).toMatch(/^data;lancamento;conta/);

    // período fechado não recebe lançamentos
    await prisma.accountingPeriod.create({ data: { organizationId: org.id, companyId: c.id, month: new Date("2026-09-01"), status: "CLOSED" } });
    await expect(syncJournal(acct, c.id, "2026-09-01")).rejects.toThrow(/fechado/);
    await expect(createManualEntry(acct, { companyId: c.id, date: "2026-09-30", description: "Após fechamento", lineAccount: [id("1.1.1.01"), id("2.3.1")], lineDebit: ["1", ""], lineCredit: ["", "1"], lineMemo: ["", ""] })).rejects.toThrow();

    // isolamento
    const other = await newOrg();
    expect(await other.ctx.db.journalEntry.count()).toBe(0);
  });
});
