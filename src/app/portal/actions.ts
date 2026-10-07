"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";
import * as T from "@/modules/ams/tickets";
import { clientDecision } from "@/modules/timesheet/service";
import { clientApproveMeasurement, clientRejectMeasurement } from "@/modules/billing/measurement";
import { decideDeliverable } from "@/modules/projects/service";
import { portalScope } from "@/modules/portal/service";
import { zArray } from "@/lib/zod-helpers";

const tp = (id: string) => `/portal/chamados/${id}`;
const portalOpenTicketActionImpl = makeAction(T.ticketSchema.pick({ type: true, system: true, module: true, title: true, description: true, impact: true, urgency: true }), async (ctx, i) => { portalScope(ctx); const t = await T.openTicket(ctx, i); return { redirectTo: tp(t.id) }; });
const portalCommentActionImpl = makeAction(z.object({ id: z.string(), body: z.string() }), async (ctx, i) => { portalScope(ctx); await T.addComment(ctx, i.id, i.body, "PUBLIC"); return { revalidate: [tp(i.id)], message: "Mensagem enviada." }; });
const portalStatusActionImpl = makeAction(z.object({ id: z.string(), to: z.enum(["CLOSED", "IN_PROGRESS"]), note: z.string().optional() }), async (ctx, i) => { portalScope(ctx); await T.changeStatus(ctx, i.id, i.to, i.note); return { revalidate: [tp(i.id)], message: i.to === "CLOSED" ? "Chamado encerrado. Obrigado!" : "Chamado retomado pela equipe." }; });
const portalRateActionImpl = makeAction(z.object({ id: z.string(), score: z.coerce.number().int(), comment: z.string().optional() }), async (ctx, i) => { portalScope(ctx); await T.rateTicket(ctx, i.id, i.score, i.comment); return { revalidate: [tp(i.id)], message: "Avaliação registrada." }; });
const portalTimeDecisionActionImpl = makeAction(z.object({ ids: zArray, decision: z.enum(["approve", "reject"]), reason: z.string().optional() }), async (ctx, i) => { portalScope(ctx); const n = await clientDecision(ctx, i.ids, i.decision === "approve", ctx.userName, i.reason); return { revalidate: ["/portal/aprovacoes"], message: `${n} apontamento(s) ${i.decision === "approve" ? "aprovado(s)" : "recusado(s)"}.` }; });
const portalMeasurementActionImpl = makeAction(z.object({ id: z.string(), decision: z.enum(["approve", "reject"]), reason: z.string().optional() }), async (ctx, i) => {
  portalScope(ctx);
  if (i.decision === "approve") await clientApproveMeasurement(ctx, i.id, ctx.userName);
  else await clientRejectMeasurement(ctx, i.id, ctx.userName, i.reason ?? "");
  return { revalidate: ["/portal/aprovacoes"], message: i.decision === "approve" ? "Medição aprovada." : "Medição recusada e devolvida para correção." };
});
const portalDeliverableActionImpl = makeAction(z.object({ id: z.string(), decision: z.enum(["approve", "reject"]), comment: z.string().optional() }), async (ctx, i) => { portalScope(ctx); await decideDeliverable(ctx, i.id, i.decision === "approve", ctx.userName, i.comment); return { revalidate: ["/portal/projetos", "/portal/aprovacoes"], message: i.decision === "approve" ? "Entregável aceito." : "Entregável recusado." }; });

export async function portalOpenTicketAction(prev: ActionState | undefined, fd: FormData) {
  return portalOpenTicketActionImpl(prev, fd);
}
export async function portalCommentAction(prev: ActionState | undefined, fd: FormData) {
  return portalCommentActionImpl(prev, fd);
}
export async function portalStatusAction(prev: ActionState | undefined, fd: FormData) {
  return portalStatusActionImpl(prev, fd);
}
export async function portalRateAction(prev: ActionState | undefined, fd: FormData) {
  return portalRateActionImpl(prev, fd);
}
export async function portalTimeDecisionAction(prev: ActionState | undefined, fd: FormData) {
  return portalTimeDecisionActionImpl(prev, fd);
}
export async function portalMeasurementAction(prev: ActionState | undefined, fd: FormData) {
  return portalMeasurementActionImpl(prev, fd);
}
export async function portalDeliverableAction(prev: ActionState | undefined, fd: FormData) {
  return portalDeliverableActionImpl(prev, fd);
}
