"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";
import * as T from "@/modules/ams/tickets";
import * as H from "@/modules/ams/hour-bank";
import * as K from "@/modules/ams/knowledge";
import { createTimeEntry } from "@/modules/timesheet/service";
import { todayIn } from "@/lib/dates";

const path = (id: string) => `/app/ams/chamados/${id}`;
const openTicketActionImpl = makeAction(T.ticketSchema, async (ctx, i) => { const t = await T.openTicket(ctx, i); return { redirectTo: path(t.id) }; });
const ticketStatusActionImpl = makeAction(z.object({ id: z.string(), to: z.string(), note: z.string().optional() }), async (ctx, i) => { await T.changeStatus(ctx, i.id, i.to, i.note); return { revalidate: [path(i.id)], message: "Situação atualizada." }; });
const ticketCommentActionImpl = makeAction(z.object({ id: z.string(), body: z.string(), visibility: z.enum(["PUBLIC", "INTERNAL"]).default("PUBLIC") }), async (ctx, i) => { await T.addComment(ctx, i.id, i.body, i.visibility); return { revalidate: [path(i.id)], message: "Comentário registrado." }; });
const ticketAssignActionImpl = makeAction(z.object({ id: z.string(), professionalId: z.string().optional(), team: z.string().optional() }), async (ctx, i) => { await T.assignTicket(ctx, i.id, i.professionalId || null, i.team || null); return { revalidate: [path(i.id)], message: "Responsável atualizado." }; });
const ticketPriorityActionImpl = makeAction(z.object({ id: z.string(), impact: z.coerce.number().int(), urgency: z.coerce.number().int(), reason: z.string() }), async (ctx, i) => { await T.changePriority(ctx, i.id, i.impact, i.urgency, i.reason); return { revalidate: [path(i.id)], message: "Prioridade e prazos recalculados." }; });
const ticketProblemActionImpl = makeAction(z.object({ id: z.string(), problemId: z.string().optional() }), async (ctx, i) => { await T.linkProblem(ctx, i.id, i.problemId || null); return { revalidate: [path(i.id)], message: "Vínculo atualizado." }; });
const ticketRateActionImpl = makeAction(z.object({ id: z.string(), score: z.coerce.number().int(), comment: z.string().optional() }), async (ctx, i) => { await T.rateTicket(ctx, i.id, i.score, i.comment); return { revalidate: [path(i.id)], message: "Avaliação registrada." }; });
const ticketTimeActionImpl = makeAction(z.object({ id: z.string(), hours: z.string(), description: z.string(), date: z.string().optional() }), async (ctx, i) => {
  const t = await T.getTicket(ctx, i.id);
  await createTimeEntry(ctx, { date: i.date || todayIn(ctx.timezone), hours: i.hours.replace(",", "."), description: `${t.number}: ${i.description}`, activityType: "SUPPORT", billable: true, ticketId: t.id });
  return { revalidate: [path(i.id)], message: "Horas registradas como rascunho (envie para aprovação em Horas)." };
});
const syncHourBankActionImpl = makeAction(z.object({ contractId: z.string() }), async (ctx, i) => { const r = await H.syncHourBank(ctx, i.contractId); return { revalidate: [`/app/ams/saldos/${i.contractId}`], message: `Apuração: ${r.franchises} franquia(s), ${r.debits} débito(s), excedente ${r.overageHours.toFixed(2)} h, expirado ${r.expired.toFixed(2)} h.` }; });
const manualEntryActionImpl = makeAction(H.manualEntrySchema, async (ctx, i) => { await H.addManualEntry(ctx, i); return { revalidate: [`/app/ams/saldos/${i.contractId}`], message: "Lançamento registrado." }; });
const overageDecisionActionImpl = makeAction(z.object({ id: z.string(), contractId: z.string(), approve: z.string(), note: z.string() }), async (ctx, i) => { await H.decideOverage(ctx, i.id, i.approve === "1", i.note); return { revalidate: [`/app/ams/saldos/${i.contractId}`], message: "Decisão registrada." }; });
const saveArticleActionImpl = makeAction(K.articleSchema.extend({ id: z.string().optional() }), async (ctx, i) => { const a = await K.saveArticle(ctx, i.id || null, i); return { redirectTo: `/app/ams/conhecimento/${a.id}` }; });

export async function openTicketAction(prev: ActionState | undefined, fd: FormData) {
  return openTicketActionImpl(prev, fd);
}
export async function ticketStatusAction(prev: ActionState | undefined, fd: FormData) {
  return ticketStatusActionImpl(prev, fd);
}
export async function ticketCommentAction(prev: ActionState | undefined, fd: FormData) {
  return ticketCommentActionImpl(prev, fd);
}
export async function ticketAssignAction(prev: ActionState | undefined, fd: FormData) {
  return ticketAssignActionImpl(prev, fd);
}
export async function ticketPriorityAction(prev: ActionState | undefined, fd: FormData) {
  return ticketPriorityActionImpl(prev, fd);
}
export async function ticketProblemAction(prev: ActionState | undefined, fd: FormData) {
  return ticketProblemActionImpl(prev, fd);
}
export async function ticketRateAction(prev: ActionState | undefined, fd: FormData) {
  return ticketRateActionImpl(prev, fd);
}
export async function ticketTimeAction(prev: ActionState | undefined, fd: FormData) {
  return ticketTimeActionImpl(prev, fd);
}
export async function syncHourBankAction(prev: ActionState | undefined, fd: FormData) {
  return syncHourBankActionImpl(prev, fd);
}
export async function manualEntryAction(prev: ActionState | undefined, fd: FormData) {
  return manualEntryActionImpl(prev, fd);
}
export async function overageDecisionAction(prev: ActionState | undefined, fd: FormData) {
  return overageDecisionActionImpl(prev, fd);
}
export async function saveArticleAction(prev: ActionState | undefined, fd: FormData) {
  return saveArticleActionImpl(prev, fd);
}
