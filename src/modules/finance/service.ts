/**
 * Contas a receber e a pagar: aprovação de CP (SoD), liquidação parcial com juros/multa/desconto, estorno por registro
 * inverso vinculado, adiantamentos (cliente/fornecedor) e aplicação, compensação autorizada, aging e recorrências.
 * Saldo do título = valor − principal liquidado − créditos aplicados − compensações (mantido em transação com bloqueio).
 */
import { z } from "zod";
import { requirePerm, requireWritable, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { nextNumber } from "@/server/sequences";
import { assertPeriodOpen } from "@/server/periods";
import { getSetting } from "@/server/settings";
import { conflict, forbidden, notFound, rule, validation } from "@/lib/errors";
import { zDate, zDecimal, zOptId, zOptStr, zStr } from "@/lib/zod-helpers";
import { addDays, addMonths, civil, monthEnd, monthStart, toCivil, todayIn } from "@/lib/dates";
import { dec, money, sum } from "@/lib/money";
import { agingBucket, settlementTotal } from "@/domain/billing";
import { accrueCommissions, reverseCommissions } from "../commissions/service";
import { postBankTx } from "./bank";
import type { TenantTx } from "@/server/tenant-db";

type Kind = "RECEIVABLE" | "PAYABLE";
const statusOf = (amount: ReturnType<typeof dec>, open: ReturnType<typeof dec>) => (open.lte(0) ? "PAID" : open.lt(amount) ? "PARTIAL" : "OPEN");

async function lockTitle(ctx: Ctx, tx: TenantTx, kind: Kind, id: string) {
  const table = kind === "RECEIVABLE" ? "Receivable" : "Payable";
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "${table}" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`, id, ctx.orgId);
  if (!rows.length) throw notFound(kind === "RECEIVABLE" ? "Título a receber" : "Título a pagar");
  return kind === "RECEIVABLE" ? tx.receivable.findFirstOrThrow({ where: { id } }) : tx.payable.findFirstOrThrow({ where: { id } });
}
async function setOpen(tx: TenantTx, kind: Kind, id: string, amount: ReturnType<typeof dec>, open: ReturnType<typeof dec>) {
  const data = { openAmount: money(open), status: statusOf(amount, open) };
  if (kind === "RECEIVABLE") await tx.receivable.update({ where: { id }, data });
  else await tx.payable.update({ where: { id }, data });
}

// ------------------------------------------------------------------ Títulos manuais e aprovação de CP
export const manualTitleSchema = z.object({ kind: z.enum(["RECEIVABLE", "PAYABLE"]), companyId: z.string().min(1), partyId: zOptId, description: zStr(3), issueDate: zDate, dueDate: zDate, competence: zDate, amount: zDecimal, accountId: zOptId, costCenterId: zOptId, projectId: zOptId });
export async function createManualTitle(ctx: Ctx, i: z.infer<typeof manualTitleSchema>) {
  requirePerm(ctx, "finance.write");
  requireWritable(ctx);
  const amount = money(i.amount);
  if (amount.lte(0)) throw validation("Valor deve ser positivo.");
  if (i.kind === "RECEIVABLE" && !i.partyId) throw validation("Informe o cliente.");
  return ctx.db.$transaction(async (tx) => {
    await assertPeriodOpen(tx, i.companyId, i.competence, "Título");
    const number = await nextNumber(tx, ctx.orgId, i.kind);
    const base = { organizationId: ctx.orgId, companyId: i.companyId, number, issueDate: civil(i.issueDate), dueDate: civil(i.dueDate), competence: civil(monthStart(i.competence)), amount, openAmount: amount, description: i.description, accountId: i.accountId ?? null, projectId: i.projectId ?? null };
    const t = i.kind === "RECEIVABLE"
      ? await tx.receivable.create({ data: { ...base, partyId: i.partyId! } })
      : await tx.payable.create({ data: { ...base, partyId: i.partyId ?? null, costCenterId: i.costCenterId ?? null, sourceType: "MANUAL", status: "PENDING_APPROVAL", createdById: ctx.userId } });
    await audit(ctx, { action: `${i.kind.toLowerCase()}.create`, entity: i.kind === "RECEIVABLE" ? "Receivable" : "Payable", entityId: t.id, companyId: i.companyId, changes: { amount: amount.toString() } }, tx);
    return t;
  });
}

export async function approvePayable(ctx: Ctx, id: string) {
  requirePerm(ctx, "payable.approve");
  requireWritable(ctx);
  const sod = await getSetting(ctx, "sod");
  const p = await ctx.db.payable.findFirst({ where: { id } });
  if (!p) throw notFound("Título a pagar");
  if (p.status !== "PENDING_APPROVAL") throw rule("Título não aguarda aprovação.");
  if (sod.requesterCannotApprove && p.createdById === ctx.userId) throw forbidden("Segregação de funções: quem registrou o título não o aprova.");
  const r = await ctx.db.payable.updateMany({ where: { id, status: "PENDING_APPROVAL" }, data: { status: "OPEN", approvedById: ctx.userId, approvedAt: new Date() } });
  if (!r.count) throw conflict("Título já decidido.");
  await audit(ctx, { action: "payable.approve", entity: "Payable", entityId: id, companyId: p.companyId });
}

// ------------------------------------------------------------------ Liquidação e estorno
export const settleSchema = z.object({ kind: z.enum(["RECEIVABLE", "PAYABLE"]), titleId: z.string(), date: zDate, principal: zDecimal, interest: z.preprocess((v) => (v === "" || v === undefined ? "0" : v), zDecimal), fine: z.preprocess((v) => (v === "" || v === undefined ? "0" : v), zDecimal), discount: z.preprocess((v) => (v === "" || v === undefined ? "0" : v), zDecimal), bankAccountId: z.string().min(1), idempotencyKey: z.string().min(8) });

export async function settle(ctx: Ctx, i: z.infer<typeof settleSchema>) {
  requirePerm(ctx, "payment.register");
  requireWritable(ctx);
  const dup = await ctx.db.settlement.findFirst({ where: { idempotencyKey: i.idempotencyKey } });
  if (dup) return dup;
  const principal = money(i.principal);
  if (principal.lte(0)) throw validation("Informe o valor principal.");
  for (const v of [i.interest, i.fine, i.discount]) if (money(v).lt(0)) throw validation("Juros, multa e desconto não podem ser negativos.");
  return ctx.db.$transaction(async (tx) => {
    const t = await lockTitle(ctx, tx, i.kind, i.titleId);
    if (i.kind === "PAYABLE" && t.status === "PENDING_APPROVAL") throw rule("Conta a pagar ainda não aprovada.");
    if (["PAID", "CANCELED", "WRITTEN_OFF"].includes(t.status)) throw rule("Título sem saldo em aberto.");
    if (principal.gt(dec(t.openAmount))) throw rule(`Valor acima do saldo em aberto (${money(t.openAmount).toFixed(2)}).`);
    await assertPeriodOpen(tx, t.companyId, i.date, "Liquidação");
    const total = settlementTotal(principal, i.interest, i.fine, i.discount);
    if (total.lte(0)) throw validation("Total da liquidação deve ser positivo.");
    const direction = i.kind === "RECEIVABLE" ? "IN" : "OUT";
    const btx = await postBankTx(ctx, tx, { bankAccountId: i.bankAccountId, companyId: t.companyId, date: i.date, amount: direction === "IN" ? total : total.negated(), description: `${direction === "IN" ? "Recebimento" : "Pagamento"} ${t.number}`, kind: "SETTLEMENT" });
    const s = await tx.settlement.create({ data: { organizationId: ctx.orgId, companyId: t.companyId, direction, receivableId: i.kind === "RECEIVABLE" ? t.id : null, payableId: i.kind === "PAYABLE" ? t.id : null, date: civil(i.date), principal, interest: money(i.interest), fine: money(i.fine), discount: money(i.discount), total, bankAccountId: i.bankAccountId, bankTransactionId: btx.id, idempotencyKey: i.idempotencyKey, createdById: ctx.userId } });
    await setOpen(tx, i.kind, t.id, dec(t.amount), dec(t.openAmount).minus(principal));
    if (i.kind === "RECEIVABLE" && (t as { contractId: string | null }).contractId) await accrueCommissions(ctx, tx, { basis: "RECEIPT", contractId: (t as { contractId: string }).contractId, sourceType: "SETTLEMENT", sourceId: s.id, baseAmount: principal, competence: monthStart(i.date) });
    // Pagamento de adiantamento a fornecedor gera crédito aplicável às notas futuras do pedido
    const pay = t as { sourceType?: string; sourceId?: string | null; partyId?: string | null };
    if (i.kind === "PAYABLE" && pay.sourceType === "SUPPLIER_ADVANCE" && pay.partyId) await tx.advance.create({ data: { organizationId: ctx.orgId, companyId: t.companyId, direction: "SUPPLIER", partyId: pay.partyId, purchaseOrderId: pay.sourceId ?? null, amount: principal, date: civil(i.date), bankAccountId: i.bankAccountId, bankTransactionId: btx.id, description: `Adiantamento pago (${t.number})`, createdById: ctx.userId } });
    await audit(ctx, { action: "settlement.post", entity: i.kind === "RECEIVABLE" ? "Receivable" : "Payable", entityId: t.id, companyId: t.companyId, changes: { principal: principal.toString(), total: total.toString(), settlement: s.id } }, tx);
    return s;
  });
}

/** Estorno: registro inverso vinculado (liquidação e movimento bancário); o original é preservado. */
export async function reverseSettlement(ctx: Ctx, id: string, reason: string, date?: string) {
  requirePerm(ctx, "payment.reverse");
  requireWritable(ctx);
  if (!reason.trim()) throw validation("Informe o motivo do estorno.");
  return ctx.db.$transaction(async (tx) => {
    const s = await tx.settlement.findFirst({ where: { id } });
    if (!s || s.reversalOfId) throw notFound("Liquidação");
    if (s.status === "REVERSED") throw rule("Liquidação já estornada.");
    const kind: Kind = s.receivableId ? "RECEIVABLE" : "PAYABLE";
    const t = await lockTitle(ctx, tx, kind, (s.receivableId ?? s.payableId)!);
    const when = date ?? todayIn(ctx.timezone);
    await assertPeriodOpen(tx, s.companyId, when, "Estorno");
    if (kind === "PAYABLE" && (t as { sourceType: string }).sourceType === "SUPPLIER_ADVANCE") {
      const adv = await tx.advance.findFirst({ where: { bankTransactionId: s.bankTransactionId } });
      if (adv && dec(adv.appliedAmount).gt(0)) throw rule("Adiantamento já aplicado: estorne as aplicações antes.");
      if (adv) await tx.advance.update({ where: { id: adv.id }, data: { status: "REVERSED" } });
    }
    const orig = s.bankTransactionId ? await tx.bankTransaction.findFirst({ where: { id: s.bankTransactionId } }) : null;
    const btx = orig ? await postBankTx(ctx, tx, { bankAccountId: orig.bankAccountId, date: when, amount: dec(orig.amount).negated(), description: `Estorno: ${orig.description}`, kind: "REVERSAL", reversalOfId: orig.id }) : null;
    const rev = await tx.settlement.create({ data: { organizationId: ctx.orgId, companyId: s.companyId, direction: s.direction, receivableId: s.receivableId, payableId: s.payableId, date: civil(when), principal: dec(s.principal).negated(), interest: dec(s.interest).negated(), fine: dec(s.fine).negated(), discount: dec(s.discount).negated(), total: dec(s.total).negated(), bankAccountId: s.bankAccountId, bankTransactionId: btx?.id ?? null, reversalOfId: s.id, reversalReason: reason, idempotencyKey: `REV:${s.id}`, createdById: ctx.userId } });
    await tx.settlement.update({ where: { id: s.id }, data: { status: "REVERSED" } });
    await setOpen(tx, kind, t.id, dec(t.amount), dec(t.openAmount).plus(s.principal));
    if (kind === "RECEIVABLE") await reverseCommissions(ctx, tx, "SETTLEMENT", s.id, monthStart(when), reason);
    await audit(ctx, { action: "settlement.reverse", entity: kind === "RECEIVABLE" ? "Receivable" : "Payable", entityId: t.id, companyId: s.companyId, reason, changes: { settlement: s.id, reversal: rev.id } }, tx);
    return rev;
  });
}

// ------------------------------------------------------------------ Adiantamentos
export const advanceSchema = z.object({ direction: z.enum(["CUSTOMER", "SUPPLIER"]), companyId: z.string().min(1), partyId: z.string().min(1), contractId: zOptId, purchaseOrderId: zOptId, amount: zDecimal, date: zDate, bankAccountId: z.string().min(1), description: zOptStr });
export async function registerAdvance(ctx: Ctx, i: z.infer<typeof advanceSchema>) {
  requirePerm(ctx, "payment.register");
  requireWritable(ctx);
  const amount = money(i.amount);
  if (amount.lte(0)) throw validation("Valor deve ser positivo.");
  return ctx.db.$transaction(async (tx) => {
    await assertPeriodOpen(tx, i.companyId, i.date, "Adiantamento");
    const btx = await postBankTx(ctx, tx, { bankAccountId: i.bankAccountId, companyId: i.companyId, date: i.date, amount: i.direction === "CUSTOMER" ? amount : amount.negated(), description: `Adiantamento ${i.direction === "CUSTOMER" ? "recebido de cliente" : "pago a fornecedor"}`, kind: "ADVANCE" });
    const a = await tx.advance.create({ data: { organizationId: ctx.orgId, companyId: i.companyId, direction: i.direction, partyId: i.partyId, contractId: i.contractId ?? null, purchaseOrderId: i.purchaseOrderId ?? null, amount, date: civil(i.date), bankAccountId: i.bankAccountId, bankTransactionId: btx.id, description: i.description ?? null, createdById: ctx.userId } });
    await audit(ctx, { action: "advance.register", entity: "Advance", entityId: a.id, companyId: i.companyId, changes: { amount: amount.toString(), direction: i.direction } }, tx);
    return a;
  });
}

/** Aplica crédito de adiantamento a um título da mesma parte (sem movimento de caixa). */
export async function applyAdvance(ctx: Ctx, advanceId: string, titleId: string, amountIn: string) {
  requirePerm(ctx, "payment.register");
  requireWritable(ctx);
  const amount = money(amountIn);
  if (amount.lte(0)) throw validation("Valor deve ser positivo.");
  return ctx.db.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Advance" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`, advanceId, ctx.orgId);
    if (!rows.length) throw notFound("Adiantamento");
    const a = await tx.advance.findFirstOrThrow({ where: { id: advanceId } });
    if (a.status !== "OPEN") throw rule("Adiantamento sem saldo.");
    const kind: Kind = a.direction === "CUSTOMER" ? "RECEIVABLE" : "PAYABLE";
    const t = await lockTitle(ctx, tx, kind, titleId);
    if ((t as { partyId: string | null }).partyId !== a.partyId) throw rule("Título de outra parte.");
    if (kind === "PAYABLE" && t.status === "PENDING_APPROVAL") throw rule("Conta a pagar ainda não aprovada.");
    const avail = dec(a.amount).minus(dec(a.appliedAmount));
    if (amount.gt(avail)) throw rule(`Saldo do adiantamento insuficiente (${money(avail).toFixed(2)}).`);
    if (amount.gt(dec(t.openAmount))) throw rule("Valor acima do saldo do título.");
    await tx.advanceApplication.create({ data: { organizationId: ctx.orgId, advanceId, receivableId: kind === "RECEIVABLE" ? t.id : null, payableId: kind === "PAYABLE" ? t.id : null, amount, createdById: ctx.userId } });
    const applied = dec(a.appliedAmount).plus(amount);
    await tx.advance.update({ where: { id: advanceId }, data: { appliedAmount: money(applied), status: applied.gte(dec(a.amount)) ? "APPLIED" : "OPEN" } });
    await setOpen(tx, kind, t.id, dec(t.amount), dec(t.openAmount).minus(amount));
    if (kind === "RECEIVABLE") {
      const bd = (t as { billingDocumentId: string | null }).billingDocumentId;
      if (bd) await tx.billingDocument.update({ where: { id: bd }, data: { advanceApplied: { increment: amount } } });
    }
    await audit(ctx, { action: "advance.apply", entity: "Advance", entityId: advanceId, changes: { title: t.number, amount: amount.toString() } }, tx);
  });
}

export async function reverseAdvanceApplication(ctx: Ctx, applicationId: string, reason: string) {
  requirePerm(ctx, "payment.reverse");
  requireWritable(ctx);
  if (!reason.trim()) throw validation("Informe o motivo.");
  await ctx.db.$transaction(async (tx) => {
    const ap = await tx.advanceApplication.findFirst({ where: { id: applicationId } });
    if (!ap || ap.status !== "POSTED") throw notFound("Aplicação");
    const kind: Kind = ap.receivableId ? "RECEIVABLE" : "PAYABLE";
    const t = await lockTitle(ctx, tx, kind, (ap.receivableId ?? ap.payableId)!);
    // atualização condicional: uma aplicação só é estornada uma vez, mesmo com chamadas simultâneas
    const flipped = await tx.advanceApplication.updateMany({ where: { id: ap.id, status: "POSTED" }, data: { status: "REVERSED" } });
    if (!flipped.count) throw conflict("Aplicação já estornada.");
    await tx.$queryRawUnsafe(`SELECT id FROM "Advance" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`, ap.advanceId, ctx.orgId);
    const a = await tx.advance.findFirstOrThrow({ where: { id: ap.advanceId } });
    await tx.advance.update({ where: { id: a.id }, data: { appliedAmount: { decrement: ap.amount }, status: "OPEN" } });
    await setOpen(tx, kind, t.id, dec(t.amount), dec(t.openAmount).plus(ap.amount));
    if (kind === "RECEIVABLE" && (t as { billingDocumentId: string | null }).billingDocumentId) await tx.billingDocument.update({ where: { id: (t as { billingDocumentId: string }).billingDocumentId }, data: { advanceApplied: { decrement: ap.amount } } });
    await audit(ctx, { action: "advance.application_reverse", entity: "Advance", entityId: a.id, reason }, tx);
  });
}

// ------------------------------------------------------------------ Compensação cliente × fornecedor
export const offsetSchema = z.object({ receivableId: z.string(), payableId: z.string(), amount: zDecimal, reason: zStr(5) });
export async function offsetTitles(ctx: Ctx, i: z.infer<typeof offsetSchema>) {
  requirePerm(ctx, "offset.approve");
  requireWritable(ctx);
  const amount = money(i.amount);
  if (amount.lte(0)) throw validation("Valor deve ser positivo.");
  return ctx.db.$transaction(async (tx) => {
    const r = await lockTitle(ctx, tx, "RECEIVABLE", i.receivableId);
    const p = await lockTitle(ctx, tx, "PAYABLE", i.payableId);
    const rp = (r as { partyId: string }).partyId;
    if (rp !== (p as { partyId: string | null }).partyId) throw rule("Compensação exige a mesma parte (cliente que também é fornecedor).");
    if (r.companyId !== p.companyId) throw rule("Títulos de empresas diferentes.");
    if (p.status === "PENDING_APPROVAL") throw rule("Conta a pagar ainda não aprovada.");
    if (amount.gt(dec(r.openAmount)) || amount.gt(dec(p.openAmount))) throw rule("Valor acima do saldo de um dos títulos.");
    const o = await tx.offset.create({ data: { organizationId: ctx.orgId, companyId: r.companyId, partyId: rp, receivableId: r.id, payableId: p.id, amount, reason: i.reason, approvedById: ctx.userId, createdById: ctx.userId } });
    await setOpen(tx, "RECEIVABLE", r.id, dec(r.amount), dec(r.openAmount).minus(amount));
    await setOpen(tx, "PAYABLE", p.id, dec(p.amount), dec(p.openAmount).minus(amount));
    await audit(ctx, { action: "offset.post", entity: "Offset", entityId: o.id, companyId: r.companyId, reason: i.reason, changes: { receivable: r.number, payable: p.number, amount: amount.toString() } }, tx);
    return o;
  });
}

export async function reverseOffset(ctx: Ctx, id: string, reason: string) {
  requirePerm(ctx, "offset.approve");
  requireWritable(ctx);
  if (!reason.trim()) throw validation("Informe o motivo.");
  await ctx.db.$transaction(async (tx) => {
    const o = await tx.offset.findFirst({ where: { id } });
    if (!o || o.status !== "POSTED") throw notFound("Compensação");
    const r = await lockTitle(ctx, tx, "RECEIVABLE", o.receivableId);
    const p = await lockTitle(ctx, tx, "PAYABLE", o.payableId);
    const flipped = await tx.offset.updateMany({ where: { id, status: "POSTED" }, data: { status: "REVERSED" } });
    if (!flipped.count) throw conflict("Compensação já estornada.");
    await setOpen(tx, "RECEIVABLE", r.id, dec(r.amount), dec(r.openAmount).plus(o.amount));
    await setOpen(tx, "PAYABLE", p.id, dec(p.amount), dec(p.openAmount).plus(o.amount));
    await audit(ctx, { action: "offset.reverse", entity: "Offset", entityId: id, reason }, tx);
  });
}

// ------------------------------------------------------------------ Aging e recorrências
export async function aging(ctx: Ctx, kind: Kind, today = todayIn(ctx.timezone)) {
  requirePerm(ctx, "finance.read");
  const where = { status: { in: ["OPEN", "PARTIAL"] } };
  const rows = kind === "RECEIVABLE" ? await ctx.db.receivable.findMany({ where }) : await ctx.db.payable.findMany({ where });
  const buckets = { A_VENCER: dec(0), "1_30": dec(0), "31_60": dec(0), "61_90": dec(0), "90_MAIS": dec(0) } as Record<ReturnType<typeof agingBucket>, ReturnType<typeof dec>>;
  for (const r of rows) buckets[agingBucket(toCivil(r.dueDate), today)] = buckets[agingBucket(toCivil(r.dueDate), today)].plus(r.openAmount);
  return { buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, money(v)])), total: money(sum(rows.map((r) => r.openAmount))), count: rows.length };
}

export const recurringSchema = z.object({ companyId: z.string().min(1), partyId: zOptId, description: zStr(3), amount: zDecimal, dayOfMonth: z.coerce.number().int().min(1).max(28), accountId: zOptId, costCenterId: zOptId, projectId: zOptId, startDate: zDate, endDate: z.preprocess((v) => (v === "" ? undefined : v), zDate.optional()) });
export async function createRecurringPayable(ctx: Ctx, i: z.infer<typeof recurringSchema>) {
  requirePerm(ctx, "finance.write");
  requireWritable(ctx);
  const r = await ctx.db.recurringPayable.create({ data: { organizationId: ctx.orgId, companyId: i.companyId, partyId: i.partyId ?? null, description: i.description, amount: money(i.amount), dayOfMonth: i.dayOfMonth, accountId: i.accountId ?? null, costCenterId: i.costCenterId ?? null, projectId: i.projectId ?? null, startDate: civil(i.startDate), endDate: i.endDate ? civil(i.endDate) : null } });
  await audit(ctx, { action: "recurring_payable.create", entity: "RecurringPayable", entityId: r.id });
  return r;
}

/** Gera as contas a pagar recorrentes até o mês informado (idempotente por origem RECURRING + recorrência:mês). */
export async function generateRecurringPayables(ctx: Ctx, untilMonth = monthStart(todayIn(ctx.timezone))) {
  const list = await ctx.db.recurringPayable.findMany({ where: { active: true } });
  let n = 0;
  for (const r of list) {
    let m = r.lastGeneratedMonth ? addMonths(toCivil(r.lastGeneratedMonth), 1) : monthStart(toCivil(r.startDate));
    for (; m <= untilMonth; m = addMonths(m, 1)) {
      if (r.endDate && m > toCivil(r.endDate)) break;
      const due = addDays(m, r.dayOfMonth - 1);
      const key = `${r.id}:${m.slice(0, 7)}`;
      await ctx.db.$transaction(async (tx) => {
        if (await tx.payable.findFirst({ where: { sourceType: "RECURRING", sourceId: key } })) return;
        const number = await nextNumber(tx, ctx.orgId, "PAYABLE");
        await tx.payable.create({ data: { organizationId: ctx.orgId, companyId: r.companyId, number, partyId: r.partyId, sourceType: "RECURRING", sourceId: key, projectId: r.projectId, costCenterId: r.costCenterId, accountId: r.accountId, issueDate: civil(m), dueDate: civil(due > monthEnd(m) ? monthEnd(m) : due), competence: civil(m), amount: r.amount, openAmount: r.amount, status: "PENDING_APPROVAL", description: `${r.description} — ${m.slice(5, 7)}/${m.slice(0, 4)}`, createdById: ctx.userId } });
        await tx.recurringPayable.update({ where: { id: r.id }, data: { lastGeneratedMonth: civil(m) } });
        n++;
      });
    }
  }
  return n;
}
