"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";
import { requirePerm, requireWritable } from "@/server/context";
import { audit } from "@/server/audit";
import { setSetting } from "@/server/settings";
import * as L from "@/modules/controlling/ledger";
import * as C from "@/modules/controlling/service";

const syncLedgerActionImpl = makeAction(z.object({ companyId: z.string(), month: z.string() }), async (ctx, i) => { const r = await L.syncLedger(ctx, i.companyId, i.month); return { revalidate: ["/app/controladoria/razao", "/app/controladoria/fechamento"], message: `${r.posted} lançamento(s) novo(s), ${r.reversed} estorno(s).` }; });
const allocationRuleActionImpl = makeAction(C.allocationRuleSchema.extend({ id: z.string().optional() }), async (ctx, i) => { await C.saveAllocationRule(ctx, i.id || null, i); return { revalidate: ["/app/controladoria/rateios"], message: i.id ? "Nova versão da regra criada." : "Regra criada." }; });
const runAllocationActionImpl = makeAction(z.object({ ruleId: z.string(), month: z.string() }), async (ctx, i) => { const r = await C.runAllocation(ctx, i.ruleId, i.month); return { revalidate: ["/app/controladoria/rateios"], message: `Rateio executado: ${r.sourceAmount.toString()} distribuído.` }; });
const reverseAllocationActionImpl = makeAction(z.object({ runId: z.string(), reason: z.string() }), async (ctx, i) => { await C.reverseAllocation(ctx, i.runId, i.reason); return { revalidate: ["/app/controladoria/rateios"], message: "Rateio estornado." }; });
const createBudgetActionImpl = makeAction(C.budgetSchema, async (ctx, i) => { const b = await C.createBudget(ctx, i); return { redirectTo: `/app/controladoria/orcamentos/${b.id}` }; });
const budgetLineActionImpl = makeAction(z.object({ budgetId: z.string(), accountId: z.string(), costCenterId: z.string().optional(), projectId: z.string().optional(), months: z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.string())), amounts: z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.string())) }), async (ctx, i) => {
  await C.setBudgetLines(ctx, i.budgetId, i.months.map((m, k) => ({ accountId: i.accountId, costCenterId: i.costCenterId || null, projectId: i.projectId || null, month: m, amount: (i.amounts[k] || "0").replace(/\./g, "").replace(",", ".") })));
  return { revalidate: [`/app/controladoria/orcamentos/${i.budgetId}`], message: "Linha salva." };
});
const approveBudgetActionImpl = makeAction(z.object({ id: z.string() }), async (ctx, i) => { await C.approveBudget(ctx, i.id); return { revalidate: [`/app/controladoria/orcamentos/${i.id}`], message: "Versão aprovada (a anterior foi substituída)." }; });
const closePeriodActionImpl = makeAction(C.closeSchema, async (ctx, i) => { await C.closePeriod(ctx, i); return { revalidate: ["/app/controladoria/fechamento"], message: "Período fechado." }; });
const reopenPeriodActionImpl = makeAction(z.object({ companyId: z.string(), month: z.string(), reason: z.string() }), async (ctx, i) => { await C.reopenPeriod(ctx, i.companyId, i.month, i.reason); return { revalidate: ["/app/controladoria/fechamento"], message: "Período reaberto (auditado)." }; });
const approveRecognitionActionImpl = makeAction(z.object({ notes: z.string().optional() }), async (ctx, i) => {
  requirePerm(ctx, "controlling.write");
  requireWritable(ctx);
  await setSetting(ctx, "revenueRecognition", { approvedBy: ctx.userName, approvedAt: new Date().toISOString(), ...(i.notes ? { notes: i.notes } : {}) });
  await audit(ctx, { action: "settings.revenue_recognition_approved", entity: "OrgSetting", entityId: "revenueRecognition" });
  return { revalidate: ["/app/controladoria/fechamento"], message: "Regras de reconhecimento aprovadas e registradas." };
});
const payrollActionImpl = makeAction(z.object({ companyId: z.string(), month: z.string(), content: z.string() }), async (ctx, i) => { const r = await C.importPayroll(ctx, i.companyId, i.month, "colado.csv", i.content); return { revalidate: ["/app/controladoria/razao"], message: `Folha importada: ${r.totalAmount.toString()}.` }; });

export async function syncLedgerAction(prev: ActionState | undefined, fd: FormData) {
  return syncLedgerActionImpl(prev, fd);
}
export async function allocationRuleAction(prev: ActionState | undefined, fd: FormData) {
  return allocationRuleActionImpl(prev, fd);
}
export async function runAllocationAction(prev: ActionState | undefined, fd: FormData) {
  return runAllocationActionImpl(prev, fd);
}
export async function reverseAllocationAction(prev: ActionState | undefined, fd: FormData) {
  return reverseAllocationActionImpl(prev, fd);
}
export async function createBudgetAction(prev: ActionState | undefined, fd: FormData) {
  return createBudgetActionImpl(prev, fd);
}
export async function budgetLineAction(prev: ActionState | undefined, fd: FormData) {
  return budgetLineActionImpl(prev, fd);
}
export async function approveBudgetAction(prev: ActionState | undefined, fd: FormData) {
  return approveBudgetActionImpl(prev, fd);
}
export async function closePeriodAction(prev: ActionState | undefined, fd: FormData) {
  return closePeriodActionImpl(prev, fd);
}
export async function reopenPeriodAction(prev: ActionState | undefined, fd: FormData) {
  return reopenPeriodActionImpl(prev, fd);
}
export async function approveRecognitionAction(prev: ActionState | undefined, fd: FormData) {
  return approveRecognitionActionImpl(prev, fd);
}
export async function payrollAction(prev: ActionState | undefined, fd: FormData) {
  return payrollActionImpl(prev, fd);
}
