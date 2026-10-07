/**
 * Tesouraria: saldos por conta, transferências, importação de extrato (CSV/OFX), conciliação 1:1 extrato × movimento do
 * livro (sem dupla contagem: cada linha concilia uma única vez — índice único), lançamento de tarifas a partir do extrato
 * e fluxo de caixa realizado e previsto.
 */
import { z } from "zod";
import { requirePerm, requireWritable, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { assertPeriodOpen } from "@/server/periods";
import { conflict, notFound, rule, validation } from "@/lib/errors";
import { zDate, zDecimal, zOptStr } from "@/lib/zod-helpers";
import { addDays, civil, toCivil, todayIn } from "@/lib/dates";
import { dec, money, sum } from "@/lib/money";
import { parseStatement } from "@/domain/statement";
import { postBankTx } from "./bank";

export async function accountBalances(ctx: Ctx, at = todayIn(ctx.timezone)) {
  requirePerm(ctx, "finance.read");
  const accounts = await ctx.db.bankAccount.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const sums = await ctx.db.bankTransaction.groupBy({ by: ["bankAccountId"], where: { date: { lte: civil(at) } }, _sum: { amount: true } });
  const pending = await ctx.db.bankStatementLine.groupBy({ by: ["bankAccountId"], where: { status: "PENDING" }, _count: true });
  return accounts.map((a) => ({ account: a, balance: money(dec(a.openingBalance).plus(sums.find((s) => s.bankAccountId === a.id)?._sum.amount ?? 0)), pendingLines: pending.find((p) => p.bankAccountId === a.id)?._count ?? 0 }));
}

export const transferSchema = z.object({ fromAccountId: z.string().min(1), toAccountId: z.string().min(1), date: zDate, amount: zDecimal, description: zOptStr });
export async function transfer(ctx: Ctx, i: z.infer<typeof transferSchema>) {
  requirePerm(ctx, "treasury.manage");
  requireWritable(ctx);
  if (i.fromAccountId === i.toAccountId) throw validation("Contas de origem e destino iguais.");
  const amount = money(i.amount);
  if (amount.lte(0)) throw validation("Valor deve ser positivo.");
  return ctx.db.$transaction(async (tx) => {
    const [from, to] = await Promise.all([tx.bankAccount.findFirst({ where: { id: i.fromAccountId } }), tx.bankAccount.findFirst({ where: { id: i.toAccountId } })]);
    if (!from || !to) throw notFound("Conta bancária");
    if (from.companyId !== to.companyId) throw rule("Transferência entre empresas diferentes exige mútuo/registro contábil próprio — não suportado como transferência.");
    await assertPeriodOpen(tx, from.companyId, i.date, "Transferência");
    const t = await tx.transfer.create({ data: { organizationId: ctx.orgId, companyId: from.companyId, fromAccountId: from.id, toAccountId: to.id, date: civil(i.date), amount, description: i.description ?? null, createdById: ctx.userId } });
    await postBankTx(ctx, tx, { bankAccountId: from.id, date: i.date, amount: amount.negated(), description: `Transferência para ${to.name}`, kind: "TRANSFER", transferId: t.id });
    await postBankTx(ctx, tx, { bankAccountId: to.id, date: i.date, amount, description: `Transferência de ${from.name}`, kind: "TRANSFER", transferId: t.id });
    await audit(ctx, { action: "treasury.transfer", entity: "Transfer", entityId: t.id, companyId: from.companyId, changes: { amount: amount.toString() } }, tx);
    return t;
  });
}

/** Importa extrato; linhas já importadas (mesmo identificador na conta) são ignoradas. */
export async function importStatement(ctx: Ctx, bankAccountId: string, fileName: string, text: string) {
  requirePerm(ctx, "treasury.manage");
  requireWritable(ctx);
  const acc = await ctx.db.bankAccount.findFirst({ where: { id: bankAccountId } });
  if (!acc) throw notFound("Conta bancária");
  let lines;
  try { lines = parseStatement(fileName, text); } catch (e) { throw validation(`Arquivo inválido: ${(e as Error).message}`); }
  if (!lines.length) throw validation("Nenhum lançamento encontrado no arquivo.");
  return ctx.db.$transaction(async (tx) => {
    const imp = await tx.statementImport.create({ data: { organizationId: ctx.orgId, bankAccountId, fileName, lines: lines.length, createdById: ctx.userId } });
    const existing = new Set((await tx.bankStatementLine.findMany({ where: { bankAccountId, externalId: { in: lines.map((l) => l.externalId) } }, select: { externalId: true } })).map((x) => x.externalId));
    const fresh = lines.filter((l) => !existing.has(l.externalId));
    if (fresh.length) await tx.bankStatementLine.createMany({ data: fresh.map((l) => ({ organizationId: ctx.orgId, bankAccountId, importId: imp.id, externalId: l.externalId, date: civil(l.date), amount: l.amount, description: l.description })) });
    await audit(ctx, { action: "treasury.statement_import", entity: "BankAccount", entityId: bankAccountId, changes: { file: fileName, lines: lines.length, imported: fresh.length, duplicates: lines.length - fresh.length } }, tx);
    return { imported: fresh.length, duplicates: lines.length - fresh.length };
  });
}

/** Sugestões: movimentos não conciliados da mesma conta, mesmo valor, data em ±5 dias (mais próximos primeiro). */
export async function suggestMatches(ctx: Ctx, lineId: string) {
  requirePerm(ctx, "treasury.manage");
  const l = await ctx.db.bankStatementLine.findFirst({ where: { id: lineId } });
  if (!l) throw notFound("Linha de extrato");
  const d = toCivil(l.date);
  const rows = await ctx.db.bankTransaction.findMany({ where: { bankAccountId: l.bankAccountId, statementLineId: null, amount: l.amount, date: { gte: civil(addDays(d, -5)), lte: civil(addDays(d, 5)) } } });
  return rows.sort((a, b) => Math.abs(a.date.getTime() - l.date.getTime()) - Math.abs(b.date.getTime() - l.date.getTime()));
}

export async function reconcile(ctx: Ctx, lineId: string, transactionId: string) {
  requirePerm(ctx, "treasury.manage");
  requireWritable(ctx);
  await ctx.db.$transaction(async (tx) => {
    const l = await tx.bankStatementLine.findFirst({ where: { id: lineId } });
    const t = await tx.bankTransaction.findFirst({ where: { id: transactionId } });
    if (!l || !t) throw notFound("Linha ou movimento");
    if (l.status !== "PENDING") throw conflict("Linha de extrato já conciliada ou ignorada.");
    if (t.statementLineId) throw conflict("Movimento já conciliado com outra linha.");
    if (l.bankAccountId !== t.bankAccountId) throw rule("Conta bancária diferente.");
    if (!dec(l.amount).eq(dec(t.amount))) throw rule("Valores diferentes: lance a diferença (tarifa/juros) antes de conciliar.");
    // atualização condicional: protege contra conciliação simultânea da mesma linha
    const r = await tx.bankStatementLine.updateMany({ where: { id: l.id, status: "PENDING" }, data: { status: "RECONCILED" } });
    if (!r.count) throw conflict("Linha de extrato já conciliada.");
    await tx.bankTransaction.update({ where: { id: t.id }, data: { statementLineId: l.id, reconciledAt: new Date() } });
    await audit(ctx, { action: "treasury.reconcile", entity: "BankTransaction", entityId: t.id, changes: { line: l.externalId } }, tx);
  });
}

export async function unreconcile(ctx: Ctx, lineId: string, reason: string) {
  requirePerm(ctx, "treasury.manage");
  if (!reason.trim()) throw validation("Informe o motivo.");
  await ctx.db.$transaction(async (tx) => {
    const t = await tx.bankTransaction.findFirst({ where: { statementLineId: lineId } });
    await tx.bankStatementLine.update({ where: { id: lineId }, data: { status: "PENDING" } });
    if (t) await tx.bankTransaction.update({ where: { id: t.id }, data: { statementLineId: null, reconciledAt: null } });
    await audit(ctx, { action: "treasury.unreconcile", entity: "BankStatementLine", entityId: lineId, reason }, tx);
  });
}

/** Cria movimento a partir da linha (tarifas, juros bancários, rendimentos) e concilia. */
export async function createFromLine(ctx: Ctx, lineId: string, description: string) {
  requirePerm(ctx, "treasury.manage");
  requireWritable(ctx);
  const l = await ctx.db.bankStatementLine.findFirst({ where: { id: lineId } });
  if (!l || l.status !== "PENDING") throw rule("Linha não está pendente.");
  const t = await ctx.db.$transaction(async (tx) => {
    const acc = await tx.bankAccount.findFirstOrThrow({ where: { id: l.bankAccountId } });
    await assertPeriodOpen(tx, acc.companyId, toCivil(l.date), "Lançamento bancário");
    return postBankTx(ctx, tx, { bankAccountId: l.bankAccountId, date: toCivil(l.date), amount: l.amount, description: description || l.description, kind: dec(l.amount).lt(0) ? "FEE" : "MANUAL" });
  });
  await reconcile(ctx, lineId, t.id);
  return t;
}

export async function ignoreLine(ctx: Ctx, lineId: string, reason: string) {
  requirePerm(ctx, "treasury.manage");
  if (!reason.trim()) throw validation("Informe o motivo.");
  const r = await ctx.db.bankStatementLine.updateMany({ where: { id: lineId, status: "PENDING" }, data: { status: "IGNORED" } });
  if (!r.count) throw rule("Linha não está pendente.");
  await audit(ctx, { action: "treasury.ignore_line", entity: "BankStatementLine", entityId: lineId, reason });
}

/**
 * Fluxo de caixa por dia/semana: realizado (movimentos bancários) até hoje; previsto a partir de hoje com títulos em
 * aberto (por vencimento; vencidos entram hoje), compromissos de compra não faturados (vencimento estimado = fim da
 * vigência ou data do pedido + 30 dias) — sem contar duas vezes o que já virou título.
 */
export async function cashFlow(ctx: Ctx, from: string, to: string, companyId?: string) {
  requirePerm(ctx, "finance.read");
  const today = todayIn(ctx.timezone);
  const cw = companyId ? { companyId } : {};
  const accounts = await ctx.db.bankAccount.findMany({ where: { active: true, ...cw } });
  const opening = sum(accounts.map((a) => a.openingBalance)).plus((await ctx.db.bankTransaction.aggregate({ where: { ...cw, date: { lt: civil(from) } }, _sum: { amount: true } }))._sum.amount ?? 0);
  const [txs, recs, pays, pos] = await Promise.all([
    ctx.db.bankTransaction.findMany({ where: { ...cw, date: { gte: civil(from), lte: civil(to < today ? to : today) } } }),
    ctx.db.receivable.findMany({ where: { ...cw, status: { in: ["OPEN", "PARTIAL"] }, dueDate: { lte: civil(to) } } }),
    ctx.db.payable.findMany({ where: { ...cw, status: { in: ["OPEN", "PARTIAL", "PENDING_APPROVAL"] }, dueDate: { lte: civil(to) } } }),
    ctx.db.purchaseOrder.findMany({ where: { ...cw, status: { in: ["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED"] } } }),
  ]);
  const poLines = await ctx.db.purchaseOrderLine.findMany({ where: { purchaseOrderId: { in: pos.map((p) => p.id) } } });
  const days = new Map<string, { date: string; realizedIn: number; realizedOut: number; forecastIn: number; forecastOut: number }>();
  const row = (d: string) => { if (!days.has(d)) days.set(d, { date: d, realizedIn: 0, realizedOut: 0, forecastIn: 0, forecastOut: 0 }); return days.get(d)!; };
  for (const t of txs) { const r = row(toCivil(t.date)); const v = Number(t.amount); if (v >= 0) r.realizedIn += v; else r.realizedOut -= v; }
  const fdate = (d: string) => (d < today ? today : d);
  for (const r of recs) if (fdate(toCivil(r.dueDate)) >= from) row(fdate(toCivil(r.dueDate))).forecastIn += Number(r.openAmount);
  for (const p of pays) if (fdate(toCivil(p.dueDate)) >= from) row(fdate(toCivil(p.dueDate))).forecastOut += Number(p.openAmount);
  for (const po of pos) {
    const open = dec(po.totalAmount).minus(sum(poLines.filter((l) => l.purchaseOrderId === po.id).map((l) => l.invoicedAmount)));
    if (open.lte(0)) continue;
    const est = fdate(po.endDate ? toCivil(po.endDate) : addDays(toCivil(po.orderDate), 30));
    if (est >= from && est <= to) row(est).forecastOut += Number(open);
  }
  let bal = Number(opening);
  const series = [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map((r) => { bal += r.realizedIn - r.realizedOut + r.forecastIn - r.forecastOut; return { ...r, balance: Math.round(bal * 100) / 100 }; });
  return { opening: money(opening), series, closing: money(bal) };
}

