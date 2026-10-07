/**
 * Faturamento e financeiro de demonstração (via serviços): medições mensais dos contratos (horas T&M, marcos,
 * mensalidades de alocação e AMS), documentos de cobrança (parciais), recebimentos (parciais, com juros, um estorno),
 * aprovação e pagamento de contas a pagar (fornecedores, reembolsos, recorrência), adiantamento a fornecedor aplicado,
 * compensação cliente/fornecedor, extrato importado e conciliado, NFS-e simulada.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../src/server/db";
import type { DemoContext } from "./seed-demo";
import { decide } from "../src/modules/approvals/service";
import { createMeasurement, submitMeasurement, billingCandidates } from "../src/modules/billing/measurement";
import { invoiceMeasurement } from "../src/modules/billing/invoice";
import { requestFiscalDocument, processFiscalDocument } from "../src/modules/billing/fiscal";
import { settle, reverseSettlement, approvePayable, applyAdvance, createManualTitle, offsetTitles, createRecurringPayable, generateRecurringPayables } from "../src/modules/finance/service";
import { importStatement, suggestMatches, reconcile, transfer } from "../src/modules/finance/treasury";
import { addDays, addMonths, monthEnd, monthStart, toCivil } from "../src/lib/dates";
import { dec } from "../src/lib/money";

export async function seedBilling(d: DemoContext) {
  const fin = d.users.financeiro.ctx;
  const admin = d.admin;
  const director = d.users.diretor.ctx;
  const T = d.today;
  const bankFor = (companyId: string) => (companyId === d.companies.main ? d.refs.bank1 : d.refs.bank3);

  async function measureAndInvoice(contractId: string, month: string, opts: { partial?: boolean } = {}) {
    const end = monthEnd(month);
    const cands = await billingCandidates(fin, contractId, "2000-01-01", end);
    if (!cands.length) return null;
    const m = await createMeasurement(fin, { contractId, periodStart: monthStart(cands.map((c) => c.date).sort()[0] < month ? cands.map((c) => c.date).sort()[0] : month), periodEnd: end, competence: month });
    if (!(await submitMeasurement(fin, m.id))) for (const ar of await prisma.approvalRequest.findMany({ where: { entityId: m.id, status: "PENDING" } })) await decide(admin, ar.id, true, "Conferida com o relatório do gestor");
    const mm = await prisma.measurement.findUniqueOrThrow({ where: { id: m.id } });
    if (mm.status !== "APPROVED") return { m: mm, doc: null };
    const items = await prisma.measurementItem.findMany({ where: { measurementId: m.id, status: "ACTIVE" }, orderBy: { description: "asc" } });
    // faturamento parcial: deixa as despesas reembolsáveis para um segundo documento
    const partialItems = items.filter((i) => i.sourceType !== "EXPENSE");
    const now = opts.partial && partialItems.length ? partialItems : items;
    const pos = await prisma.customerPurchaseOrder.findMany({ where: { contractId, active: true } });
    let doc = null;
    for (const po of pos.length ? pos.map((p) => p.number) : [undefined]) {
      try { doc = await invoiceMeasurement(fin, { measurementId: m.id, issueDate: addDays(end, 1) > T ? T : addDays(end, 1), idempotencyKey: randomUUID(), itemIds: now.map((i) => i.id), discountAmount: "0", customerPo: po }); break; } catch (e) { if (!/Saldo da OC/.test((e as Error).message)) throw e; }
    }
    return { m: mm, doc };
  }

  // 1) Medições e cobranças dos últimos meses
  const docs: { id: string; companyId: string }[] = [];
  for (let k = 4; k >= 1; k--) {
    const month = monthStart(addMonths(T, -k));
    for (const key of ["tm", "alloc", "ams", "fixed"]) {
      const r = await measureAndInvoice(d.refs[key], month, { partial: key === "fixed" && k === 3 });
      if (r?.doc) docs.push({ id: r.doc.id, companyId: r.doc.companyId });
    }
  }
  // 2) Recebimentos: tudo que venceu até 15 dias atrás, com um parcial, um com juros e um estornado
  const recs = await prisma.receivable.findMany({ where: { organizationId: d.orgId, status: "OPEN", dueDate: { lte: new Date(addDays(T, -15)) } }, orderBy: { dueDate: "asc" } });
  for (const [i, r] of recs.entries()) {
    const due = toCivil(r.dueDate);
    const late = i % 5 === 2;
    const s = await settle(fin, { kind: "RECEIVABLE", titleId: r.id, date: late ? addDays(due, 6) : due, principal: i % 7 === 3 ? dec(r.amount).times(0.6).toFixed(2) : r.amount.toString(), interest: late ? dec(r.amount).times(0.002).toFixed(2) : "0", fine: late ? dec(r.amount).times(0.02).toFixed(2) : "0", discount: "0", bankAccountId: bankFor(r.companyId), idempotencyKey: randomUUID() });
    if (i === 1) await reverseSettlement(fin, s.id, "Depósito identificado em duplicidade pelo banco", toCivil(s.date) < T ? addDays(toCivil(s.date), 1) : T).then(() => settle(fin, { kind: "RECEIVABLE", titleId: r.id, date: addDays(due, 2), principal: r.amount.toString(), interest: "0", fine: "0", discount: "0", bankAccountId: bankFor(r.companyId), idempotencyKey: randomUUID() }));
  }
  // 3) Contas a pagar: recorrência de aluguel, aprovações (SoD: diretoria aprova) e pagamentos
  await createRecurringPayable(fin, { companyId: d.companies.main, description: "Aluguel do escritório", amount: "8500", dayOfMonth: 10, accountId: (await prisma.managerialAccount.findFirstOrThrow({ where: { organizationId: d.orgId, systemKey: "ADMIN_EXPENSES" } })).id, costCenterId: d.refs.ccAdm, startDate: monthStart(addMonths(T, -4)) });
  await generateRecurringPayables(fin);
  for (const p of await prisma.payable.findMany({ where: { organizationId: d.orgId, status: "PENDING_APPROVAL" } })) {
    if (p.sourceType === "SUPPLIER_INVOICE" && toCivil(p.dueDate) > addDays(T, 10)) continue; // fica aguardando aprovação
    await approvePayable(director, p.id);
  }
  const toPay = await prisma.payable.findMany({ where: { organizationId: d.orgId, status: "OPEN", dueDate: { lte: new Date(addDays(T, -3)) } }, orderBy: { dueDate: "asc" } });
  for (const p of toPay) await settle(fin, { kind: "PAYABLE", titleId: p.id, date: toCivil(p.dueDate), principal: p.amount.toString(), interest: "0", fine: "0", discount: "0", bankAccountId: bankFor(p.companyId), idempotencyKey: randomUUID() });
  // adiantamento ao fornecedor de licenças: paga o título de adiantamento e aplica na nota do pedido
  const advPay = await prisma.payable.findFirst({ where: { organizationId: d.orgId, sourceType: "SUPPLIER_ADVANCE", status: "OPEN" } });
  if (advPay) {
    await settle(fin, { kind: "PAYABLE", titleId: advPay.id, date: toCivil(advPay.issueDate), principal: advPay.amount.toString(), interest: "0", fine: "0", discount: "0", bankAccountId: d.refs.bank1, idempotencyKey: randomUUID() });
    const adv = await prisma.advance.findFirstOrThrow({ where: { organizationId: d.orgId, purchaseOrderId: advPay.sourceId } });
    const inv = await prisma.supplierInvoice.findFirst({ where: { organizationId: d.orgId, purchaseOrderId: advPay.sourceId, status: "APPROVED" } });
    const invPay = inv ? await prisma.payable.findFirst({ where: { sourceType: "SUPPLIER_INVOICE", sourceId: inv.id } }) : null;
    if (invPay && ["OPEN", "PARTIAL"].includes(invPay.status)) await applyAdvance(fin, adv.id, invPay.id, adv.amount.toString());
  }
  // 4) Compensação: Gama é cliente e fornecedor (locação de sala para treinamento)
  const gamaRec = await prisma.receivable.findFirst({ where: { organizationId: d.orgId, partyId: d.parties.Gama, status: { in: ["OPEN", "PARTIAL"] } } });
  if (gamaRec) {
    const pay = await createManualTitle(fin, { kind: "PAYABLE", companyId: gamaRec.companyId, partyId: d.parties.Gama, description: "Locação de sala para treinamento de usuários", issueDate: addDays(T, -10), dueDate: addDays(T, 20), competence: addDays(T, -10), amount: "1200" });
    await approvePayable(director, pay.id);
    await offsetTitles(director, { receivableId: gamaRec.id, payableId: pay.id, amount: "1200", reason: "Encontro de contas autorizado pelo financeiro do cliente (e-mail anexado)" });
  }
  // 5) Tesouraria: aplicação financeira e extrato do último mês (quase tudo concilia; tarifa fica pendente)
  await transfer(fin, { fromAccountId: d.refs.bank1, toAccountId: d.refs.bank2, date: addDays(T, -20), amount: "30000", description: "Aplicação de excedente de caixa" });
  const since = addDays(T, -30);
  const txs = await prisma.bankTransaction.findMany({ where: { organizationId: d.orgId, bankAccountId: d.refs.bank1, date: { gte: new Date(since) } }, orderBy: { date: "asc" } });
  const csv = ["data;descrição;valor;id", ...txs.slice(0, Math.max(0, txs.length - 2)).map((t, i) => `${toCivil(t.date).split("-").reverse().join("/")};${t.description.toUpperCase()};${t.amount.toFixed(2).replace(".", ",")};EXT${i}`), `${addDays(T, -2).split("-").reverse().join("/")};TARIFA PACOTE DE SERVIÇOS;-89,90;EXTFEE`].join("\n");
  await importStatement(fin, d.refs.bank1, `extrato-${since}.csv`, csv);
  for (const l of await prisma.bankStatementLine.findMany({ where: { bankAccountId: d.refs.bank1, status: "PENDING" } })) {
    const m = await suggestMatches(fin, l.id);
    if (m[0]) await reconcile(fin, l.id, m[0].id);
  }
  // 6) NFS-e: solicitação simulada (sem código de serviço cadastrado → rejeição explicativa, sem inventar códigos)
  if (docs[0]) { const fd = await requestFiscalDocument(fin, docs[0].id); await processFiscalDocument(fd.id); }
}
