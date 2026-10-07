/**
 * Despesas e adiantamentos.
 * Distinção explícita por despesa:
 *  - amount: custo da empresa (vai para o projeto/centro de custo);
 *  - reimbursableToProfessional: valor devido ao profissional (quando pago por ele);
 *  - billableAmount: valor cobrável do cliente (reembolso via medição).
 * Rastreabilidade: despesa → conta a pagar (reembolso) → pagamento; despesa → item de medição → cobrança.
 */
import { z } from "zod";
import { requirePerm, requireWritable, can, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { nextNumber } from "@/server/sequences";
import { assertPeriodOpen } from "@/server/periods";
import { forbidden, notFound, rule, validation } from "@/lib/errors";
import { zDate, zDecimal, zOptId, zBool } from "@/lib/zod-helpers";
import { addDays, civil, monthStart, toCivil, todayIn } from "@/lib/dates";
import { dec, money, sum } from "@/lib/money";
import { openApprovals, registerApprovalHandler } from "../approvals/service";
import type { TenantTx } from "@/server/tenant-db";

export const expenseSchema = z.object({
  professionalId: zOptId, date: zDate, categoryId: z.string().min(1, "Selecione a categoria"), description: z.string().trim().min(3), amount: zDecimal,
  paidBy: z.enum(["PROFESSIONAL", "COMPANY"]).default("PROFESSIONAL"), billableToClient: zBool, billableAmount: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  projectId: zOptId, contractId: zOptId, costCenterId: zOptId, advanceId: zOptId, companyId: zOptId,
});
export type ExpenseInput = z.infer<typeof expenseSchema>;

async function resolve(ctx: Ctx, i: ExpenseInput) {
  const professionalId = i.professionalId ?? ctx.professionalId ?? null;
  if (i.paidBy === "PROFESSIONAL" && !professionalId) throw validation("Despesa paga pelo profissional exige o profissional.");
  if (professionalId && professionalId !== ctx.professionalId && !can(ctx, "expense.approve") && !can(ctx, "finance.write")) throw forbidden("Você só pode lançar as próprias despesas.");
  const cat = await ctx.db.expenseCategory.findFirst({ where: { id: i.categoryId, active: true } });
  if (!cat) throw validation("Categoria inválida.");
  const amount = money(i.amount);
  if (amount.lte(0)) throw validation("Valor deve ser maior que zero.");
  if (cat.maxAmount && amount.gt(dec(cat.maxAmount))) throw rule(`Valor acima do limite da categoria (${dec(cat.maxAmount).toFixed(2)}).`);
  let companyId = i.companyId ?? null;
  let contractId = i.contractId ?? null;
  let partyId: string | null = null;
  if (i.projectId) {
    const p = await ctx.db.project.findFirst({ where: { id: i.projectId } });
    if (!p) throw validation("Projeto inválido.");
    companyId = p.companyId;
    contractId = contractId ?? p.contractId;
    partyId = p.partyId;
  }
  if (contractId) {
    const c = await ctx.db.contract.findFirst({ where: { id: contractId } });
    if (!c) throw validation("Contrato inválido.");
    companyId = companyId ?? c.companyId;
    partyId = c.partyId;
  }
  if (!companyId && professionalId) companyId = (await ctx.db.professional.findFirstOrThrow({ where: { id: professionalId } })).companyId;
  if (!companyId) throw validation("Informe a empresa, projeto ou contrato.");
  if (i.billableToClient && !contractId) throw validation("Despesa cobrável do cliente exige projeto/contrato.");
  const billableAmount = i.billableToClient ? money(i.billableAmount && i.billableAmount !== "" ? i.billableAmount.replace(",", ".") : amount) : money(0);
  if (billableAmount.lt(0)) throw validation("Valor cobrável inválido.");
  if (!i.projectId && !contractId && !i.costCenterId) throw validation("Informe projeto, contrato ou centro de custo (apropriação).");
  if (i.advanceId) {
    const a = await ctx.db.expenseAdvance.findFirst({ where: { id: i.advanceId } });
    if (!a || a.professionalId !== professionalId || a.companyId !== companyId) throw validation("Adiantamento inválido para este profissional/empresa.");
    if (i.paidBy !== "PROFESSIONAL") throw validation("Somente despesas pagas pelo profissional são abatidas de adiantamento.");
    if (!["APPROVED", "PAID"].includes(a.status)) throw rule("Adiantamento precisa estar aprovado/pago e ainda não prestado contas.");
  }
  return { professionalId, companyId, contractId, partyId, amount, billableAmount };
}

export async function createExpense(ctx: Ctx, i: ExpenseInput) {
  requirePerm(ctx, "expense.write");
  requireWritable(ctx);
  const r = await resolve(ctx, i);
  await assertPeriodOpen(ctx.db, r.companyId, i.date, "Despesa");
  const e = await ctx.db.expense.create({
    data: {
      organizationId: ctx.orgId, companyId: r.companyId, professionalId: r.professionalId, date: civil(i.date), categoryId: i.categoryId, description: i.description, amount: r.amount, paidBy: i.paidBy,
      reimbursableToProfessional: i.paidBy === "PROFESSIONAL" ? r.amount : money(0), billableToClient: i.billableToClient, billableAmount: r.billableAmount, partyId: r.partyId, contractId: r.contractId,
      projectId: i.projectId ?? null, costCenterId: i.costCenterId ?? null, advanceId: i.advanceId ?? null, createdById: ctx.userId,
    },
  });
  await audit(ctx, { action: "expense.create", entity: "Expense", entityId: e.id, companyId: r.companyId, changes: { amount: r.amount.toString(), billable: r.billableAmount.toString(), paidBy: i.paidBy } });
  return e;
}

export async function submitExpense(ctx: Ctx, id: string) {
  requirePerm(ctx, "expense.write");
  requireWritable(ctx);
  const result = await ctx.db.$transaction(async (tx) => {
    const e = await tx.expense.findFirst({ where: { id } });
    if (!e) throw notFound("Despesa");
    if (!["DRAFT", "REJECTED"].includes(e.status)) throw rule("Despesa já enviada.");
    const receipts = await tx.attachment.count({ where: { entity: "Expense", entityId: id } });
    if (receipts === 0) throw rule("Anexe o comprovante antes de enviar.");
    const { approved } = await openApprovals(ctx, tx, { docType: "EXPENSE", entity: "Expense", entityId: id, facts: { companyId: e.companyId, amount: e.amount } });
    await tx.expense.update({ where: { id }, data: { status: "SUBMITTED", rejectionReason: null } });
    if (approved) await approveExpense(ctx, tx, id);
    await audit(ctx, { action: "expense.submit", entity: "Expense", entityId: id }, tx);
    return approved;
  });
  return result;
}

/** Aprovação: cria conta a pagar de reembolso (quando paga pelo profissional) e torna cobrável do cliente. */
async function approveExpense(ctx: Ctx, tx: TenantTx, id: string) {
  const e = await tx.expense.findFirstOrThrow({ where: { id } });
  await assertPeriodOpen(tx, e.companyId, e.date, "Aprovação de despesa");
  let payableId: string | null = null;
  const due = toCivil(e.date) > todayIn(ctx.timezone) ? toCivil(e.date) : addDays(todayIn(ctx.timezone), 7);
  if (e.advanceId) {
    // Adiantamento já prestado contas não absorve novas despesas (o reembolso ficaria sem conta a pagar)
    const a = await tx.expenseAdvance.findFirst({ where: { id: e.advanceId } });
    if (!a || !["APPROVED", "PAID"].includes(a.status)) throw rule("O adiantamento vinculado já foi prestado contas ou não está ativo. Remova o vínculo da despesa.");
  }
  if (e.paidBy === "PROFESSIONAL" && dec(e.reimbursableToProfessional).gt(0) && !e.advanceId) {
    const prof = await tx.professional.findFirstOrThrow({ where: { id: e.professionalId! } });
    const number = await nextNumber(tx, ctx.orgId, "PAYABLE");
    const p = await tx.payable.create({
      data: {
        organizationId: ctx.orgId, companyId: e.companyId, number, partyId: prof.supplierPartyId, professionalId: prof.id, sourceType: "EXPENSE_REIMBURSEMENT", sourceId: e.id, projectId: e.projectId, costCenterId: e.costCenterId,
        accountId: (await tx.expenseCategory.findFirst({ where: { id: e.categoryId } }))?.accountId ?? null, issueDate: civil(todayIn(ctx.timezone)), dueDate: civil(due), competence: civil(monthStart(toCivil(e.date))),
        amount: e.reimbursableToProfessional, openAmount: e.reimbursableToProfessional, status: "OPEN", description: `Reembolso: ${e.description}`, approvedById: ctx.userId, approvedAt: new Date(), createdById: ctx.userId,
      },
    });
    payableId = p.id;
  }
  await tx.expense.update({ where: { id }, data: { status: "APPROVED", approvedById: ctx.userId, approvedAt: new Date(), payableId, billingStatus: e.billableToClient && dec(e.billableAmount).gt(0) ? "ELIGIBLE" : "NOT_BILLABLE" } });
  await audit(ctx, { action: "expense.approved", entity: "Expense", entityId: id, companyId: e.companyId, changes: { payableId } }, tx);
}

registerApprovalHandler("Expense", {
  label: "Despesa",
  link: (id) => `/app/despesas/${id}`,
  onApproved: approveExpense,
  onRejected: async (ctx, tx, id, comment) => {
    await tx.expense.update({ where: { id }, data: { status: "REJECTED", rejectionReason: comment } });
    await audit(ctx, { action: "expense.rejected", entity: "Expense", entityId: id, reason: comment }, tx);
  },
});

// ------------------------------------------------------------------ Adiantamentos
export const advanceSchema = z.object({ professionalId: zOptId, amount: zDecimal, purpose: z.string().trim().min(3), projectId: zOptId });
export async function requestAdvance(ctx: Ctx, i: z.infer<typeof advanceSchema>) {
  requirePerm(ctx, "expense.write");
  requireWritable(ctx);
  const professionalId = i.professionalId ?? ctx.professionalId;
  if (!professionalId) throw validation("Usuário sem profissional vinculado.");
  const prof = await ctx.db.professional.findFirstOrThrow({ where: { id: professionalId } });
  if (money(i.amount).lte(0)) throw validation("Valor inválido.");
  const a = await ctx.db.expenseAdvance.create({ data: { organizationId: ctx.orgId, companyId: prof.companyId, professionalId, projectId: i.projectId ?? null, amount: money(i.amount), purpose: i.purpose, createdById: ctx.userId } });
  await audit(ctx, { action: "advance.request", entity: "ExpenseAdvance", entityId: a.id, changes: { amount: i.amount } });
  return a;
}

/** Aprovação do adiantamento gera conta a pagar ao profissional. */
export async function approveAdvance(ctx: Ctx, id: string) {
  requirePerm(ctx, "expense.approve");
  requireWritable(ctx);
  return ctx.db.$transaction(async (tx) => {
    const a = await tx.expenseAdvance.findFirst({ where: { id } });
    if (!a || a.status !== "REQUESTED") throw rule("Adiantamento não está pendente.");
    if (a.createdById === ctx.userId) throw forbidden("Segregação de funções: quem solicitou não aprova.");
    const prof = await tx.professional.findFirstOrThrow({ where: { id: a.professionalId } });
    const today = todayIn(ctx.timezone);
    const number = await nextNumber(tx, ctx.orgId, "PAYABLE");
    const p = await tx.payable.create({ data: { organizationId: ctx.orgId, companyId: a.companyId, number, partyId: prof.supplierPartyId, professionalId: prof.id, sourceType: "EXPENSE_ADVANCE", sourceId: a.id, projectId: a.projectId, issueDate: civil(today), dueDate: civil(addDays(today, 2)), competence: civil(monthStart(today)), amount: a.amount, openAmount: a.amount, status: "OPEN", description: `Adiantamento: ${a.purpose}`, approvedById: ctx.userId, approvedAt: new Date(), createdById: ctx.userId } });
    await tx.expenseAdvance.update({ where: { id }, data: { status: "APPROVED", approvedById: ctx.userId, payableId: p.id } });
    await audit(ctx, { action: "advance.approve", entity: "ExpenseAdvance", entityId: id }, tx);
  });
}

/**
 * Prestação de contas: soma despesas aprovadas vinculadas ao adiantamento.
 * Se despesas > adiantamento, gera conta a pagar da diferença; se menor, registra saldo a devolver.
 */
export async function settleAdvance(ctx: Ctx, id: string) {
  requirePerm(ctx, "expense.approve");
  requireWritable(ctx);
  return ctx.db.$transaction(async (tx) => {
    const a = await tx.expenseAdvance.findFirst({ where: { id } });
    if (!a || a.status !== "PAID" && a.status !== "APPROVED") throw rule("Adiantamento precisa estar aprovado/pago.");
    const exps = await tx.expense.findMany({ where: { advanceId: id, status: "APPROVED" } });
    const spent = money(sum(exps.map((e) => e.reimbursableToProfessional)));
    const diff = spent.minus(dec(a.amount));
    let payableId: string | null = null;
    if (diff.gt(0)) {
      const prof = await tx.professional.findFirstOrThrow({ where: { id: a.professionalId } });
      const today = todayIn(ctx.timezone);
      const number = await nextNumber(tx, ctx.orgId, "PAYABLE");
      payableId = (await tx.payable.create({ data: { organizationId: ctx.orgId, companyId: a.companyId, number, partyId: prof.supplierPartyId, professionalId: prof.id, sourceType: "EXPENSE_REIMBURSEMENT", sourceId: `advance:${a.id}`, projectId: a.projectId, issueDate: civil(today), dueDate: civil(addDays(today, 7)), competence: civil(monthStart(today)), amount: diff, openAmount: diff, status: "OPEN", description: "Diferença de prestação de contas", approvedById: ctx.userId, approvedAt: new Date(), createdById: ctx.userId } })).id;
    }
    await tx.expenseAdvance.update({ where: { id }, data: { status: "SETTLED", settledAmount: spent } });
    await audit(ctx, { action: "advance.settle", entity: "ExpenseAdvance", entityId: id, changes: { spent: spent.toString(), difference: diff.toString(), payableId, toReturn: diff.lt(0) ? diff.abs().toString() : "0" } }, tx);
    return { spent, diff, payableId };
  });
}
