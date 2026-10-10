/**
 * Contabilidade em partidas dobradas.
 *
 * Lançamentos automáticos (idempotentes por chave; sincronização por empresa e mês; período fechado não recebe):
 *  Documento de cobrança emitido ..... D Clientes (títulos) + D Tributos retidos a compensar / C Receita de serviços
 *  Cobrança cancelada ................ lançamento inverso na data do cancelamento
 *  Pedido de produtos entregue ....... D Clientes / C Receita de mercadorias (custo: pelas saídas de estoque)
 *  Título a receber avulso ........... D Clientes / C conta mapeada (padrão: outras receitas)
 *  Conta a pagar aprovada ............ D despesa/estoque/adiantamento conforme a origem e o de-para / C Fornecedores
 *  Liquidação recebida ............... D Banco + D Descontos concedidos / C Clientes + C Receitas financeiras
 *  Liquidação paga ................... D Fornecedores + D Despesas financeiras / C Banco + C Receitas financeiras (desconto obtido)
 *  Estorno de liquidação ............. valores negativos → lados invertidos
 *  Adiantamento (cliente/fornecedor) . D Banco / C Adiantamentos de clientes; D Adiantamentos a fornecedores / C Banco
 *  Aplicação de adiantamento ......... D Adiantamentos de clientes / C Clientes; D Fornecedores / C Adiantamentos a fornecedores
 *  Compensação cliente/fornecedor .... D Fornecedores / C Clientes
 *  Tarifas, lançamentos e transferências bancárias, folha importada
 *  Estoque ........................... entrada por compra D Estoque / C Mercadorias recebidas a faturar (baixada pela NF do
 *                                      fornecedor); venda D CMV / C Estoque; consumo D Materiais aplicados / C Estoque;
 *                                      ajustes D/C Perdas e ajustes; saldo inicial D Estoque / C Saldos de implantação
 * O plano sugerido e o de-para são revisados pelo contador; os relatórios não substituem a escrituração oficial (ECD/ECF).
 */
import { z } from "zod";
import { requirePerm, requireWritable, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { nextNumber } from "@/server/sequences";
import { assertPeriodOpen, isPeriodOpen } from "@/server/periods";
import { conflict, notFound, rule, validation } from "@/lib/errors";
import { zArray, zBool, zDate, zOptId, zOptStr, zStr } from "@/lib/zod-helpers";
import { addMonths, civil, monthEnd, monthStart, toCivil } from "@/lib/dates";
import { dec, money, sum } from "@/lib/money";
import { SUGGESTED_CHART, parentCode, isDebitNature } from "@/domain/chart-of-accounts";
import { invert, isBalanced, naturalBalance, normalizeLines, totals, type DraftLine, type NormalLine } from "@/domain/journal";

const n = (s: string | undefined) => { const v = (s ?? "").trim(); return v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v || "0"; };

// ------------------------------------------------------------------ Plano de contas
export async function ensureSuggestedChart(ctx: Ctx) {
  requirePerm(ctx, "accounting.write");
  requireWritable(ctx);
  if (await ctx.db.ledgerAccount.count()) return { created: 0 };
  const ids = new Map<string, string>();
  for (const a of SUGGESTED_CHART) {
    let p = parentCode(a.code);
    while (p && !ids.has(p)) p = parentCode(p);
    const row = await ctx.db.ledgerAccount.create({ data: { organizationId: ctx.orgId, code: a.code, name: a.name, nature: a.nature, analytic: a.analytic, parentId: p ? ids.get(p)! : null, systemKey: a.systemKey ?? null } });
    ids.set(a.code, row.id);
  }
  await audit(ctx, { action: "ledger_chart.create_suggested", entity: "LedgerAccount", entityId: null, changes: { accounts: SUGGESTED_CHART.length } });
  return { created: SUGGESTED_CHART.length };
}

export const accountSchema = z.object({ id: zOptId, code: zStr(1), name: zStr(2), nature: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]), analytic: zBool, referentialCode: zOptStr, active: zBool });
export async function saveLedgerAccount(ctx: Ctx, i: z.infer<typeof accountSchema>) {
  requirePerm(ctx, "accounting.write");
  requireWritable(ctx);
  if (!/^\d+(\.\d+)*$/.test(i.code)) throw validation("Código no formato 1.1.2.01 (números separados por ponto).");
  const dupe = await ctx.db.ledgerAccount.findFirst({ where: { code: i.code, ...(i.id ? { NOT: { id: i.id } } : {}) } });
  if (dupe) throw conflict(`Já existe conta com o código ${i.code}.`);
  let p = parentCode(i.code);
  let parent = null;
  while (p && !parent) { parent = await ctx.db.ledgerAccount.findFirst({ where: { code: p } }); if (!parent) p = parentCode(p); }
  if (parent && parent.analytic) throw rule(`A conta superior ${parent.code} é analítica: torne-a sintética antes de criar subcontas.`);
  if (parent && parent.nature !== i.nature) throw validation(`Natureza diferente da conta superior (${parent.code}).`);
  const data = { code: i.code, name: i.name, nature: i.nature, analytic: i.analytic, referentialCode: i.referentialCode ?? null, active: i.active, parentId: parent?.id ?? null };
  if (i.id) {
    const before = await ctx.db.ledgerAccount.findFirst({ where: { id: i.id } });
    if (!before) throw notFound("Conta");
    const used = await ctx.db.journalLine.count({ where: { accountId: before.id } });
    if (used && (before.nature !== i.nature || (before.analytic && !i.analytic))) throw rule("Conta com lançamentos não pode mudar de natureza nem deixar de ser analítica.");
    if (!i.active && before.systemKey) throw rule("Conta usada pelos lançamentos automáticos não pode ser desativada.");
    const a = await ctx.db.ledgerAccount.update({ where: { id: i.id }, data });
    await audit(ctx, { action: "ledger_account.update", entity: "LedgerAccount", entityId: a.id, changes: { code: i.code, referentialCode: i.referentialCode } });
    return a;
  }
  const a = await ctx.db.ledgerAccount.create({ data: { organizationId: ctx.orgId, ...data } });
  await audit(ctx, { action: "ledger_account.create", entity: "LedgerAccount", entityId: a.id, changes: { code: i.code, name: i.name } });
  return a;
}

export const mappingSchema = z.object({ sourceType: z.enum(["BANK_ACCOUNT", "MANAGERIAL_ACCOUNT"]), sourceId: z.string().min(1), accountId: z.string().min(1) });
export async function saveMapping(ctx: Ctx, i: z.infer<typeof mappingSchema>) {
  requirePerm(ctx, "accounting.write");
  requireWritable(ctx);
  const acc = await ctx.db.ledgerAccount.findFirst({ where: { id: i.accountId, active: true } });
  if (!acc || !acc.analytic) throw validation("Escolha uma conta contábil analítica e ativa.");
  if (i.sourceType === "BANK_ACCOUNT" && acc.nature !== "ASSET") throw validation("Conta bancária deve ser mapeada para conta do ativo.");
  const existing = await ctx.db.ledgerMapping.findFirst({ where: { sourceType: i.sourceType, sourceId: i.sourceId } });
  const m = existing
    ? await ctx.db.ledgerMapping.update({ where: { id: existing.id }, data: { accountId: acc.id } })
    : await ctx.db.ledgerMapping.create({ data: { organizationId: ctx.orgId, sourceType: i.sourceType, sourceId: i.sourceId, accountId: acc.id } });
  await audit(ctx, { action: "ledger_mapping.save", entity: "LedgerMapping", entityId: m.id, changes: { sourceType: i.sourceType, account: acc.code } });
  return m;
}

// ------------------------------------------------------------------ Lançamentos automáticos
interface DraftEntry { key: string; date: string; description: string; sourceType: string; sourceId: string; lines: DraftLine[] }

const sk = (k: string) => `sk:${k}`;

/** Gera (sem gravar) os lançamentos esperados das operações da empresa com data no mês. */
export async function expectedEntries(ctx: Ctx, companyId: string, monthIn: string): Promise<DraftEntry[]> {
  const month = monthStart(monthIn);
  const from = civil(month);
  const to = civil(monthEnd(month));
  const inMonth = (d: Date | null | undefined) => !!d && d >= from && d <= to;
  const out: DraftEntry[] = [];
  const bankAcc = (id: string) => `bank:${id}`;

  // Documentos de cobrança (serviços)
  const bdocs = await ctx.db.billingDocument.findMany({ where: { companyId, OR: [{ issueDate: { gte: from, lte: to } }, { canceledAt: { gte: from, lte: civil(addMonths(month, 1)) } }] } });
  if (bdocs.length) {
    const recs = await ctx.db.receivable.findMany({ where: { billingDocumentId: { in: bdocs.map((b) => b.id) } } });
    for (const b of bdocs) {
      const clientes = money(sum(recs.filter((r) => r.billingDocumentId === b.id).map((r) => r.amount)));
      const withheld = money(b.withholdingAmount);
      const lines: DraftLine[] = [{ account: sk("RECEIVABLES"), debit: clientes, partyId: b.partyId }, { account: sk("WITHHELD_TAXES"), debit: withheld, partyId: b.partyId }, { account: sk("REV_SERVICES"), credit: clientes.plus(withheld), partyId: b.partyId }];
      if (inMonth(b.issueDate)) out.push({ key: `BDOC:${b.id}`, date: toCivil(b.issueDate), description: `Documento de cobrança ${b.number}`, sourceType: "BILLING_DOCUMENT", sourceId: b.id, lines });
      if (b.status === "CANCELED" && b.canceledAt) {
        const cd = toCivil(b.canceledAt) < toCivil(b.issueDate) ? toCivil(b.issueDate) : toCivil(b.canceledAt);
        if (cd >= month && cd <= monthEnd(month)) out.push({ key: `BDOC-CANCEL:${b.id}`, date: cd, description: `Cancelamento do documento ${b.number}`, sourceType: "BILLING_DOCUMENT", sourceId: b.id, lines: lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })) });
      }
    }
  }
  // Pedidos de produtos entregues (receita) e cancelados após a entrega (inverso na data do estorno do estoque)
  const orders = await ctx.db.productOrder.findMany({ where: { companyId, deliveredAt: { not: null } } });
  for (const o of orders) {
    const lines: DraftLine[] = [{ account: sk("RECEIVABLES"), debit: o.totalAmount, partyId: o.partyId }, { account: sk("REV_GOODS"), credit: o.totalAmount, partyId: o.partyId }];
    if (inMonth(o.deliveredAt)) out.push({ key: `PORD:${o.id}`, date: toCivil(o.deliveredAt!), description: `Venda ${o.number}`, sourceType: "PRODUCT_ORDER", sourceId: o.id, lines });
    if (o.status === "CANCELED") {
      const rev = await ctx.db.stockMovement.findFirst({ where: { sourceType: "SALE_ORDER", sourceId: o.id, type: "REVERSAL" }, orderBy: { date: "desc" } });
      const cd = rev ? toCivil(rev.date) : toCivil(o.updatedAt);
      if (cd >= month && cd <= monthEnd(month)) out.push({ key: `PORD-CANCEL:${o.id}`, date: cd, description: `Cancelamento da venda ${o.number}`, sourceType: "PRODUCT_ORDER", sourceId: o.id, lines: lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })) });
    }
  }
  // Títulos a receber avulsos
  const mapping = new Map((await ctx.db.ledgerMapping.findMany()).map((m) => [`${m.sourceType}:${m.sourceId}`, m.accountId]));
  const mapped = (managerialId: string | null | undefined, fallback: string) => (managerialId && mapping.get(`MANAGERIAL_ACCOUNT:${managerialId}`) ? `id:${mapping.get(`MANAGERIAL_ACCOUNT:${managerialId}`)}` : sk(fallback));
  for (const r of await ctx.db.receivable.findMany({ where: { companyId, billingDocumentId: null, productOrderId: null, issueDate: { gte: from, lte: to } } })) {
    out.push({ key: `REC:${r.id}`, date: toCivil(r.issueDate), description: `Título a receber ${r.number}${r.description ? ` — ${r.description}` : ""}`, sourceType: "RECEIVABLE", sourceId: r.id, lines: [{ account: sk("RECEIVABLES"), debit: r.amount, partyId: r.partyId }, { account: mapped(r.accountId, "REV_OTHER"), credit: r.amount, partyId: r.partyId }] });
  }
  // Contas a pagar aprovadas (data de emissão); NF de fornecedor com itens de estoque baixa "mercadorias recebidas a faturar"
  const pays = await ctx.db.payable.findMany({ where: { companyId, issueDate: { gte: from, lte: to }, status: { notIn: ["PENDING_APPROVAL"] } } });
  const invIds = pays.filter((p) => p.sourceType === "SUPPLIER_INVOICE" && p.sourceId).map((p) => p.sourceId!);
  const invs = new Map((await ctx.db.supplierInvoice.findMany({ where: { id: { in: invIds } } })).map((i) => [i.id, i]));
  const poIds = [...invs.values()].map((i) => i.purchaseOrderId).filter((x): x is string => !!x);
  const pos = new Map((await ctx.db.purchaseOrder.findMany({ where: { id: { in: poIds } } })).map((p) => [p.id, p]));
  const poLines = await ctx.db.purchaseOrderLine.findMany({ where: { purchaseOrderId: { in: poIds }, productId: { not: null } } });
  const postedPay = new Set((await ctx.db.journalEntry.findMany({ where: { companyId, sourceType: "PAYABLE", dedupeKey: { startsWith: `${companyId}:PAY:` } }, select: { dedupeKey: true } })).map((e) => e.dedupeKey!.slice(companyId.length + 5)));
  for (const p of pays) {
    if (p.status === "CANCELED" && !postedPay.has(p.id)) continue; // cancelada antes de ser contabilizada: nada a lançar
    const base = { partyId: p.partyId, costCenterId: p.costCenterId };
    let debit: DraftLine[];
    if (p.sourceType === "SUPPLIER_INVOICE" && p.sourceId) {
      const inv = invs.get(p.sourceId);
      const po = inv?.purchaseOrderId ? pos.get(inv.purchaseOrderId) : null;
      const stockAmt = po ? money(sum(poLines.filter((l) => l.purchaseOrderId === po.id).map((l) => l.amount))) : dec(0);
      const share = po && dec(po.totalAmount).gt(0) ? (stockAmt.div(dec(po.totalAmount)).gt(1) ? dec(1) : stockAmt.div(dec(po.totalAmount))) : dec(0);
      const toStock = money(dec(p.amount).times(share));
      const rest = money(dec(p.amount).minus(toStock));
      debit = [{ account: sk("GRNI"), debit: toStock, ...base }, { account: mapped(po?.accountId ?? p.accountId, "THIRD_PARTY"), debit: rest, ...base }];
    } else if (p.sourceType === "SUPPLIER_ADVANCE" || p.sourceType === "EXPENSE_ADVANCE") {
      debit = [{ account: sk("SUPPLIER_ADVANCES"), debit: p.amount, ...base }];
    } else if (p.sourceType === "PAYROLL") {
      debit = [{ account: sk("PAYROLL_PAYABLE"), debit: p.amount, ...base }];
    } else {
      debit = [{ account: mapped(p.accountId, "EXPENSES"), debit: p.amount, ...base }];
    }
    const lines = [...debit, { account: sk("PAYABLES"), credit: p.amount, ...base }];
    out.push({ key: `PAY:${p.id}`, date: toCivil(p.issueDate), description: `Conta a pagar ${p.number}${p.description ? ` — ${p.description}` : ""}`, sourceType: "PAYABLE", sourceId: p.id, lines });
  }
  // Contas a pagar canceladas depois de aprovadas: inverso na data do cancelamento
  for (const p of await ctx.db.payable.findMany({ where: { companyId, status: "CANCELED", id: { in: [...postedPay] }, updatedAt: { gte: from, lt: civil(addMonths(month, 1)) } } })) {
    out.push({ key: `PAY-CANCEL:${p.id}`, date: toCivil(p.updatedAt) < toCivil(p.issueDate) ? toCivil(p.issueDate) : toCivil(p.updatedAt), description: `Cancelamento da conta a pagar ${p.number}`, sourceType: "PAYABLE", sourceId: p.id, lines: [{ account: sk("PAYABLES"), debit: p.amount, partyId: p.partyId }, { account: mapped(p.accountId, "EXPENSES"), credit: p.amount, partyId: p.partyId }] });
  }
  // Liquidações (inclui estornos, com valores negativos)
  const setts = await ctx.db.settlement.findMany({ where: { companyId, date: { gte: from, lte: to } } });
  const titleParty = new Map<string, string | null>();
  for (const r of await ctx.db.receivable.findMany({ where: { id: { in: setts.map((s) => s.receivableId).filter((x): x is string => !!x) } }, select: { id: true, partyId: true } })) titleParty.set(r.id, r.partyId);
  for (const r of await ctx.db.payable.findMany({ where: { id: { in: setts.map((s) => s.payableId).filter((x): x is string => !!x) } }, select: { id: true, partyId: true } })) titleParty.set(r.id, r.partyId);
  for (const s of setts) {
    const charges = dec(s.interest).plus(dec(s.fine));
    const partyId = titleParty.get(s.receivableId ?? s.payableId ?? "") ?? null;
    const lines: DraftLine[] = s.direction === "IN"
      ? [{ account: bankAcc(s.bankAccountId), debit: s.total }, { account: sk("DISCOUNTS_GRANTED"), debit: s.discount }, { account: sk("RECEIVABLES"), credit: s.principal, partyId }, { account: sk("FIN_INCOME"), credit: charges }]
      : [{ account: sk("PAYABLES"), debit: s.principal, partyId }, { account: sk("FIN_EXPENSE"), debit: charges }, { account: bankAcc(s.bankAccountId), credit: s.total }, { account: sk("FIN_INCOME"), credit: s.discount }];
    out.push({ key: `SET:${s.id}`, date: toCivil(s.date), description: `${s.reversalOfId ? "Estorno de " : ""}${s.direction === "IN" ? "recebimento" : "pagamento"}`, sourceType: "SETTLEMENT", sourceId: s.id, lines });
  }
  // Saldo inicial das contas bancárias (implantação)
  for (const b of await ctx.db.bankAccount.findMany({ where: { companyId, openingDate: { gte: from, lte: to } } })) {
    if (dec(b.openingBalance).isZero()) continue;
    out.push({ key: `BANKOPEN:${b.id}`, date: toCivil(b.openingDate), description: `Saldo inicial — ${b.name}`, sourceType: "BANK_ACCOUNT", sourceId: b.id, lines: [{ account: bankAcc(b.id), debit: b.openingBalance }, { account: sk("OPENING_BALANCES"), credit: b.openingBalance }] });
  }
  // Movimentos bancários sem liquidação: adiantamentos, tarifas, lançamentos avulsos e transferências
  const btxs = await ctx.db.bankTransaction.findMany({ where: { companyId, date: { gte: from, lte: to }, kind: { in: ["ADVANCE", "FEE", "MANUAL", "TRANSFER"] } } });
  const advByTx = new Map((await ctx.db.advance.findMany({ where: { bankTransactionId: { in: btxs.map((b) => b.id) } } })).map((a) => [a.bankTransactionId!, a]));
  const seenTransfer = new Set<string>();
  for (const b of btxs) {
    const amt = dec(b.amount);
    if (b.kind === "TRANSFER") {
      if (!b.transferId || seenTransfer.has(b.transferId)) continue;
      seenTransfer.add(b.transferId);
      const pair = btxs.filter((x) => x.transferId === b.transferId);
      const outTx = pair.find((x) => dec(x.amount).lt(0)), inTx = pair.find((x) => dec(x.amount).gt(0));
      if (!outTx || !inTx) continue;
      out.push({ key: `TRF:${b.transferId}`, date: toCivil(b.date), description: "Transferência entre contas", sourceType: "TRANSFER", sourceId: b.transferId, lines: [{ account: bankAcc(inTx.bankAccountId), debit: inTx.amount }, { account: bankAcc(outTx.bankAccountId), credit: dec(outTx.amount).negated() }] });
      continue;
    }
    const counter = b.kind === "ADVANCE" ? (advByTx.get(b.id)?.direction === "SUPPLIER" ? sk("SUPPLIER_ADVANCES") : sk("CUSTOMER_ADVANCES")) : b.kind === "FEE" ? sk("FIN_EXPENSE") : amt.gt(0) ? sk("REV_OTHER") : sk("EXPENSES");
    const partyId = advByTx.get(b.id)?.partyId ?? null;
    out.push({ key: `BTX:${b.id}`, date: toCivil(b.date), description: b.description, sourceType: "BANK_TRANSACTION", sourceId: b.id, lines: [{ account: bankAcc(b.bankAccountId), debit: amt }, { account: counter, credit: amt, partyId }] });
  }
  // Aplicação de adiantamentos (e estornos) e compensações
  const apps = await ctx.db.advanceApplication.findMany({ where: { createdAt: { gte: from, lt: civil(addMonths(month, 1)) } } });
  const advs = new Map((await ctx.db.advance.findMany({ where: { id: { in: apps.map((a) => a.advanceId) }, companyId } })).map((a) => [a.id, a]));
  for (const a of apps) {
    const adv = advs.get(a.advanceId);
    if (!adv) continue;
    const lines: DraftLine[] = adv.direction === "CUSTOMER" ? [{ account: sk("CUSTOMER_ADVANCES"), debit: a.amount, partyId: adv.partyId }, { account: sk("RECEIVABLES"), credit: a.amount, partyId: adv.partyId }] : [{ account: sk("PAYABLES"), debit: a.amount, partyId: adv.partyId }, { account: sk("SUPPLIER_ADVANCES"), credit: a.amount, partyId: adv.partyId }];
    out.push({ key: `ADVAPP:${a.id}`, date: toCivil(a.createdAt), description: "Aplicação de adiantamento", sourceType: "ADVANCE_APPLICATION", sourceId: a.id, lines });
    if (a.status === "REVERSED") out.push({ key: `ADVAPP-REV:${a.id}`, date: toCivil(a.createdAt), description: "Estorno de aplicação de adiantamento", sourceType: "ADVANCE_APPLICATION", sourceId: a.id, lines: lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })) });
  }
  for (const o of await ctx.db.offset.findMany({ where: { companyId, createdAt: { gte: from, lt: civil(addMonths(month, 1)) } } })) {
    const lines: DraftLine[] = [{ account: sk("PAYABLES"), debit: o.amount, partyId: o.partyId }, { account: sk("RECEIVABLES"), credit: o.amount, partyId: o.partyId }];
    out.push({ key: `OFF:${o.id}`, date: toCivil(o.createdAt), description: `Compensação: ${o.reason}`, sourceType: "OFFSET", sourceId: o.id, lines });
    if (o.status === "REVERSED") out.push({ key: `OFF-REV:${o.id}`, date: toCivil(o.createdAt), description: "Estorno de compensação", sourceType: "OFFSET", sourceId: o.id, lines: lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })) });
  }
  // Folha importada (consolidada)
  for (const p of await ctx.db.payrollImport.findMany({ where: { companyId, competence: civil(month), status: "POSTED" } })) {
    out.push({ key: `PAYROLL:${p.id}`, date: monthEnd(month), description: "Folha de pagamento importada", sourceType: "PAYROLL_IMPORT", sourceId: p.id, lines: [{ account: sk("PAYROLL_EXPENSE"), debit: p.totalAmount }, { account: sk("PAYROLL_PAYABLE"), credit: p.totalAmount }] });
  }
  // Estoque
  const movs = await ctx.db.stockMovement.findMany({ where: { companyId, date: { gte: from, lte: to } } });
  const origins = new Map((await ctx.db.stockMovement.findMany({ where: { id: { in: movs.map((m) => m.reversalOfId).filter((x): x is string => !!x) } } })).map((m) => [m.id, m]));
  const COUNTER: Record<string, string> = { PURCHASE_RECEIPT: "GRNI", PURCHASE_RETURN: "GRNI", SALE: "COGS", SALE_RETURN: "COGS", ADJUSTMENT_IN: "INVENTORY_ADJ", ADJUSTMENT_OUT: "INVENTORY_ADJ", COUNT_ADJUSTMENT: "INVENTORY_ADJ", CONSUMPTION: "MATERIALS_COST", OPENING: "OPENING_BALANCES" };
  for (const m of movs) {
    const kind = m.type === "REVERSAL" ? origins.get(m.reversalOfId ?? "")?.type : m.type;
    const counter = kind ? COUNTER[kind] : undefined;
    if (!counter) continue; // transferências não mudam a conta de estoque
    const v = dec(m.totalCost);
    if (v.isZero()) continue;
    out.push({ key: `STK:${m.id}`, date: toCivil(m.date), description: `${m.number} — ${m.reason ?? kind}`, sourceType: "STOCK_MOVEMENT", sourceId: m.id, lines: [{ account: sk("INVENTORY"), debit: v, costCenterId: m.costCenterId }, { account: sk(counter), credit: v, costCenterId: m.costCenterId, partyId: m.partyId }] });
  }
  return out;
}

async function resolver(ctx: Ctx) {
  const accounts = await ctx.db.ledgerAccount.findMany();
  const bySk = new Map(accounts.filter((a) => a.systemKey).map((a) => [a.systemKey!, a]));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const bankMap = new Map((await ctx.db.ledgerMapping.findMany({ where: { sourceType: "BANK_ACCOUNT" } })).map((m) => [m.sourceId, m.accountId]));
  return (ref: string) => {
    const [kind, val] = [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)];
    const a = kind === "sk" ? bySk.get(val) : kind === "id" ? byId.get(val) : kind === "bank" ? byId.get(bankMap.get(val) ?? "") ?? bySk.get("BANKS") : undefined;
    if (!a) throw rule(kind === "sk" ? `Conta contábil do sistema não encontrada: ${val}. Crie o plano sugerido ou indique a conta.` : "Conta contábil do de-para não encontrada.");
    if (!a.analytic || !a.active) throw rule(`Conta ${a.code} precisa ser analítica e ativa para receber lançamentos.`);
    return a.id;
  };
}

/** Lança o que falta do mês (idempotente). Retorna quantos lançamentos foram criados. */
export async function syncJournal(ctx: Ctx, companyId: string, monthIn: string) {
  requirePerm(ctx, "accounting.write");
  requireWritable(ctx);
  const month = monthStart(monthIn);
  if (!(await isPeriodOpen(ctx.db, companyId, month))) throw rule(`Período ${month.slice(5, 7)}/${month.slice(0, 4)} fechado.`);
  if (!(await ctx.db.ledgerAccount.count())) throw rule("Crie o plano de contas (sugerido ou próprio) antes de contabilizar.");
  const resolve = await resolver(ctx);
  const expected = await expectedEntries(ctx, companyId, month);
  const have = new Set((await ctx.db.journalEntry.findMany({ where: { companyId, dedupeKey: { in: expected.map((e) => `${companyId}:${e.key}`) } }, select: { dedupeKey: true } })).map((e) => e.dedupeKey));
  let posted = 0;
  const skipped: string[] = [];
  for (const e of expected) {
    const dedupeKey = `${companyId}:${e.key}`;
    if (have.has(dedupeKey)) continue;
    const lines = normalizeLines(e.lines.map((l) => ({ ...l, account: resolve(l.account) })));
    if (!lines.length) continue;
    if (!isBalanced(lines)) { skipped.push(e.key); continue; }
    await ctx.db.$transaction(async (tx) => {
      const number = await nextNumber(tx, ctx.orgId, "JOURNAL_ENTRY");
      const je = await tx.journalEntry.create({ data: { organizationId: ctx.orgId, companyId, number, date: civil(e.date), description: e.description, origin: "AUTO", sourceType: e.sourceType, sourceId: e.sourceId, dedupeKey, createdById: ctx.userId } });
      await tx.journalLine.createMany({ data: lines.map((l) => ({ organizationId: ctx.orgId, entryId: je.id, companyId, date: civil(e.date), accountId: l.account, debit: l.debit, credit: l.credit, partyId: l.partyId, costCenterId: l.costCenterId, memo: l.memo })) });
    }).catch((err: unknown) => { if (!String(err).includes("Unique constraint")) throw err; }); // concorrência: outro processo lançou
    posted++;
  }
  await audit(ctx, { action: "journal.sync", entity: "Company", entityId: companyId, companyId, changes: { month, expected: expected.length, posted, skipped } });
  return { expected: expected.length, posted, skipped };
}

// ------------------------------------------------------------------ Lançamentos manuais e estornos
export const manualEntrySchema = z.object({ companyId: z.string().min(1), date: zDate, description: zStr(3), lineAccount: zArray, lineDebit: zArray, lineCredit: zArray, lineMemo: zArray });
export async function createManualEntry(ctx: Ctx, i: z.infer<typeof manualEntrySchema>) {
  requirePerm(ctx, "accounting.write");
  requireWritable(ctx);
  const drafts = i.lineAccount.map((a, idx) => ({ account: a, debit: n(i.lineDebit[idx]), credit: n(i.lineCredit[idx]), memo: i.lineMemo[idx] || null })).filter((l) => l.account);
  if (drafts.some((d) => dec(d.debit).lt(0) || dec(d.credit).lt(0))) throw validation("Valores não podem ser negativos.");
  if (drafts.some((d) => dec(d.debit).gt(0) && dec(d.credit).gt(0))) throw validation("Cada linha deve ter débito OU crédito.");
  const lines = normalizeLines(drafts);
  if (lines.length < 2) throw validation("Informe ao menos uma linha a débito e uma a crédito.");
  const t = totals(lines);
  if (!isBalanced(lines)) throw validation(`Lançamento desbalanceado: débitos ${t.debit.toFixed(2)} × créditos ${t.credit.toFixed(2)}.`);
  const accounts = await ctx.db.ledgerAccount.findMany({ where: { id: { in: lines.map((l) => l.account) } } });
  if (accounts.length !== new Set(lines.map((l) => l.account)).size || accounts.some((a) => !a.analytic || !a.active)) throw validation("Use somente contas analíticas e ativas.");
  return ctx.db.$transaction(async (tx) => {
    await assertPeriodOpen(tx, i.companyId, i.date, "Lançamento contábil");
    const number = await nextNumber(tx, ctx.orgId, "JOURNAL_ENTRY");
    const je = await tx.journalEntry.create({ data: { organizationId: ctx.orgId, companyId: i.companyId, number, date: civil(i.date), description: i.description, origin: "MANUAL", createdById: ctx.userId } });
    await tx.journalLine.createMany({ data: lines.map((l) => ({ organizationId: ctx.orgId, entryId: je.id, companyId: i.companyId, date: civil(i.date), accountId: l.account, debit: l.debit, credit: l.credit, memo: l.memo })) });
    await audit(ctx, { action: "journal.manual", entity: "JournalEntry", entityId: je.id, companyId: i.companyId, changes: { number, total: t.debit.toString() } }, tx);
    return je;
  });
}

export async function reverseEntry(ctx: Ctx, id: string, reason: string, date: string) {
  requirePerm(ctx, "accounting.write");
  requireWritable(ctx);
  if (reason.trim().length < 3) throw validation("Informe o motivo do estorno.");
  return ctx.db.$transaction(async (tx) => {
    const je = await tx.journalEntry.findFirst({ where: { id } });
    if (!je) throw notFound("Lançamento");
    if (je.origin !== "MANUAL") throw rule("Lançamentos automáticos são corrigidos na operação de origem (cancelamento/estorno), que gera o lançamento inverso.");
    if (je.status === "REVERSED" || je.reversalOfId) throw rule("Lançamento já estornado ou é um estorno.");
    const when = date < toCivil(je.date) ? toCivil(je.date) : date;
    await assertPeriodOpen(tx, je.companyId, when, "Estorno contábil");
    const lines = await tx.journalLine.findMany({ where: { entryId: je.id } });
    const inv = invert(lines.map((l) => ({ account: l.accountId, debit: dec(l.debit), credit: dec(l.credit), partyId: l.partyId, costCenterId: l.costCenterId, memo: l.memo })) as NormalLine[]);
    const number = await nextNumber(tx, ctx.orgId, "JOURNAL_ENTRY");
    const rev = await tx.journalEntry.create({ data: { organizationId: ctx.orgId, companyId: je.companyId, number, date: civil(when), description: `Estorno de ${je.number}: ${reason}`, origin: "MANUAL", reversalOfId: je.id, reversalReason: reason, createdById: ctx.userId } });
    await tx.journalLine.createMany({ data: inv.map((l) => ({ organizationId: ctx.orgId, entryId: rev.id, companyId: je.companyId, date: civil(when), accountId: l.account, debit: l.debit, credit: l.credit, partyId: l.partyId, costCenterId: l.costCenterId, memo: l.memo })) });
    await tx.journalEntry.update({ where: { id: je.id }, data: { status: "REVERSED", reversalReason: reason } });
    await audit(ctx, { action: "journal.reverse", entity: "JournalEntry", entityId: je.id, companyId: je.companyId, changes: { reversal: number }, reason }, tx);
    return rev;
  });
}

// ------------------------------------------------------------------ Relatórios
export interface TrialRow { id: string; code: string; name: string; nature: string; analytic: boolean; level: number; opening: ReturnType<typeof dec>; debit: ReturnType<typeof dec>; credit: ReturnType<typeof dec>; closing: ReturnType<typeof dec> }

/** Balancete: saldo anterior, débitos, créditos e saldo final (sentido natural), com totalização nas contas sintéticas. */
export async function trialBalance(ctx: Ctx, companyId: string | null, from: string, to: string): Promise<TrialRow[]> {
  requirePerm(ctx, "accounting.read");
  const accounts = await ctx.db.ledgerAccount.findMany({ orderBy: { code: "asc" } });
  const where = companyId ? { companyId } : {};
  const [before, period] = await Promise.all([
    ctx.db.journalLine.groupBy({ by: ["accountId"], where: { ...where, date: { lt: civil(from) } }, _sum: { debit: true, credit: true } }),
    ctx.db.journalLine.groupBy({ by: ["accountId"], where: { ...where, date: { gte: civil(from), lte: civil(to) } }, _sum: { debit: true, credit: true } }),
  ]);
  const own = new Map<string, { od: ReturnType<typeof dec>; oc: ReturnType<typeof dec>; d: ReturnType<typeof dec>; c: ReturnType<typeof dec> }>();
  for (const a of accounts) own.set(a.id, { od: dec(0), oc: dec(0), d: dec(0), c: dec(0) });
  for (const b of before) { const x = own.get(b.accountId); if (x) { x.od = dec(b._sum.debit ?? 0); x.oc = dec(b._sum.credit ?? 0); } }
  for (const p of period) { const x = own.get(p.accountId); if (x) { x.d = dec(p._sum.debit ?? 0); x.c = dec(p._sum.credit ?? 0); } }
  // totaliza nas superiores (pelo parentId)
  const children = new Map<string, string[]>();
  for (const a of accounts) if (a.parentId) children.set(a.parentId, [...(children.get(a.parentId) ?? []), a.id]);
  const agg = new Map<string, { od: ReturnType<typeof dec>; oc: ReturnType<typeof dec>; d: ReturnType<typeof dec>; c: ReturnType<typeof dec> }>();
  const roll = (id: string): { od: ReturnType<typeof dec>; oc: ReturnType<typeof dec>; d: ReturnType<typeof dec>; c: ReturnType<typeof dec> } => {
    if (agg.has(id)) return agg.get(id)!;
    const base = { ...own.get(id)! };
    for (const c of children.get(id) ?? []) { const r = roll(c); base.od = base.od.plus(r.od); base.oc = base.oc.plus(r.oc); base.d = base.d.plus(r.d); base.c = base.c.plus(r.c); }
    agg.set(id, base);
    return base;
  };
  const level = (code: string) => code.split(".").length;
  return accounts.map((a) => {
    const r = roll(a.id);
    const opening = naturalBalance(a.nature, r.od, r.oc);
    return { id: a.id, code: a.code, name: a.name, nature: a.nature, analytic: a.analytic, level: level(a.code), opening, debit: money(r.d), credit: money(r.c), closing: naturalBalance(a.nature, r.od.plus(r.d), r.oc.plus(r.c)) };
  }).filter((r) => !r.opening.isZero() || !r.debit.isZero() || !r.credit.isZero() || !r.closing.isZero());
}

/** Demonstração do resultado (contábil) do período: receitas − custos/despesas, por conta analítica. */
export async function incomeStatement(ctx: Ctx, companyId: string | null, from: string, to: string) {
  const rows = (await trialBalance(ctx, companyId, from, to)).filter((r) => r.analytic && (r.nature === "REVENUE" || r.nature === "EXPENSE"));
  const period = (r: TrialRow) => naturalBalance(r.nature, r.debit, r.credit);
  const revenues = rows.filter((r) => r.nature === "REVENUE").map((r) => ({ ...r, amount: period(r) }));
  const expenses = rows.filter((r) => r.nature === "EXPENSE").map((r) => ({ ...r, amount: period(r) }));
  const totalRevenue = money(sum(revenues.map((r) => r.amount)));
  const totalExpense = money(sum(expenses.map((r) => r.amount)));
  return { revenues, expenses, totalRevenue, totalExpense, result: money(totalRevenue.minus(totalExpense)) };
}

/** Balanço patrimonial na data: ativo × passivo + PL + resultado acumulado ainda não encerrado. */
export async function balanceSheet(ctx: Ctx, companyId: string | null, at: string) {
  const rows = await trialBalance(ctx, companyId, "1900-01-01", at);
  const top = (nature: string) => rows.filter((r) => r.nature === nature && r.analytic);
  const total = (nature: string) => money(sum(top(nature).map((r) => r.closing)));
  const result = money(total("REVENUE").minus(total("EXPENSE")));
  const assets = total("ASSET"), liabilities = total("LIABILITY"), equity = total("EQUITY");
  return { rows, assets, liabilities, equity, result, liabilitiesAndEquity: money(liabilities.plus(equity).plus(result)), balanced: assets.eq(liabilities.plus(equity).plus(result)) };
}

export async function accountLedger(ctx: Ctx, accountId: string, companyId: string | null, from: string, to: string) {
  requirePerm(ctx, "accounting.read");
  const a = await ctx.db.ledgerAccount.findFirst({ where: { id: accountId } });
  if (!a) throw notFound("Conta");
  const where = { accountId, ...(companyId ? { companyId } : {}) };
  const prev = await ctx.db.journalLine.aggregate({ where: { ...where, date: { lt: civil(from) } }, _sum: { debit: true, credit: true } });
  let balance = naturalBalance(a.nature, prev._sum.debit ?? 0, prev._sum.credit ?? 0);
  const opening = balance;
  const lines = await ctx.db.journalLine.findMany({ where: { ...where, date: { gte: civil(from), lte: civil(to) } }, orderBy: [{ date: "asc" }, { id: "asc" }], take: 2000 });
  const entries = new Map((await ctx.db.journalEntry.findMany({ where: { id: { in: lines.map((l) => l.entryId) } } })).map((e) => [e.id, e]));
  const rows = lines.map((l) => {
    balance = money(balance.plus(isDebitNature(a.nature) ? dec(l.debit).minus(dec(l.credit)) : dec(l.credit).minus(dec(l.debit))));
    return { ...l, entry: entries.get(l.entryId)!, balance };
  });
  return { account: a, opening, rows, closing: balance };
}

/** Exportação do diário em CSV (conferência e importação pelo escritório contábil; leiaute a combinar com o contador). */
export async function journalCsv(ctx: Ctx, companyId: string, from: string, to: string) {
  requirePerm(ctx, "accounting.read");
  const [entries, accounts] = await Promise.all([ctx.db.journalEntry.findMany({ where: { companyId, date: { gte: civil(from), lte: civil(to) } }, orderBy: [{ date: "asc" }, { number: "asc" }] }), ctx.db.ledgerAccount.findMany()]);
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const lines = await ctx.db.journalLine.findMany({ where: { entryId: { in: entries.map((e) => e.id) } } });
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const out = ["data;lancamento;conta;nome_conta;conta_referencial;debito;credito;historico;origem"];
  for (const e of entries) for (const l of lines.filter((x) => x.entryId === e.id)) {
    const a = acc.get(l.accountId);
    out.push([toCivil(e.date), e.number, a?.code ?? "", esc(a?.name ?? ""), a?.referentialCode ?? "", dec(l.debit).toFixed(2).replace(".", ","), dec(l.credit).toFixed(2).replace(".", ","), esc(e.description), e.origin].join(";"));
  }
  return out.join("\n");
}
