"use server";
import { z } from "zod";
import { makeAction } from "@/server/action";
import * as E from "@/modules/expenses/service";

export const createExpenseAction = makeAction(E.expenseSchema, async (ctx, i) => { const e = await E.createExpense(ctx, i); return { redirectTo: `/app/despesas/${e.id}` }; });
export const submitExpenseAction = makeAction(z.object({ id: z.string() }), async (ctx, i) => { const auto = await E.submitExpense(ctx, i.id); return { revalidate: [`/app/despesas/${i.id}`], message: auto ? "Despesa aprovada (sem alçada aplicável)." : "Despesa enviada para aprovação." }; });
export const requestAdvanceAction = makeAction(E.advanceSchema, async (ctx, i) => { await E.requestAdvance(ctx, i); return { revalidate: ["/app/despesas"], message: "Adiantamento solicitado." }; });
export const approveAdvanceAction = makeAction(z.object({ id: z.string() }), async (ctx, i) => { await E.approveAdvance(ctx, i.id); return { revalidate: ["/app/despesas"], message: "Adiantamento aprovado; conta a pagar gerada." }; });
export const settleAdvanceAction = makeAction(z.object({ id: z.string() }), async (ctx, i) => { const r = await E.settleAdvance(ctx, i.id); return { revalidate: ["/app/despesas"], message: r.diff.gt(0) ? `Prestação de contas: diferença de ${r.diff.toFixed(2)} a pagar ao profissional.` : r.diff.lt(0) ? `Prestação de contas: ${r.diff.abs().toFixed(2)} a devolver pelo profissional.` : "Prestação de contas zerada." }; });
