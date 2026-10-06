"use server";
import { z } from "zod";
import { makeAction } from "@/server/action";
import * as CRM from "@/modules/crm/service";
import { createProposal } from "@/modules/proposals/service";

export const createLeadAction = makeAction(CRM.leadSchema, async (ctx, i) => { await CRM.createLead(ctx, i); return { revalidate: ["/app/crm/leads"], message: "Lead cadastrado." }; });
export const leadStatusAction = makeAction(z.object({ id: z.string(), status: z.enum(["QUALIFIED", "DISQUALIFIED"]) }), async (ctx, i) => { await CRM.setLeadStatus(ctx, i.id, i.status); return { revalidate: ["/app/crm/leads"] }; });
export const convertLeadAction = makeAction(z.object({ id: z.string(), companyId: z.string().min(1), title: z.string().min(3), estimatedValue: z.string(), serviceId: z.string().optional(), document: z.string().optional() }), async (ctx, i) => {
  const { opp } = await CRM.convertLead(ctx, i.id, { ...i, serviceId: i.serviceId || undefined, document: i.document || undefined });
  return { redirectTo: `/app/crm/oportunidades/${opp.id}` };
});
export const createOpportunityAction = makeAction(CRM.opportunitySchema, async (ctx, i) => { const o = await CRM.createOpportunity(ctx, i); return { redirectTo: `/app/crm/oportunidades/${o.id}` }; });
export const updateOpportunityAction = makeAction(CRM.opportunitySchema.and(z.object({ id: z.string() })), async (ctx, i) => { await CRM.updateOpportunity(ctx, i.id, i); return { revalidate: [`/app/crm/oportunidades/${i.id}`], message: "Oportunidade atualizada." }; });
export const moveStageAction = makeAction(z.object({ id: z.string(), stageId: z.string() }), async (ctx, i) => { await CRM.moveStage(ctx, i.id, i.stageId); return { revalidate: ["/app/crm/oportunidades", `/app/crm/oportunidades/${i.id}`] }; });
export const winAction = makeAction(z.object({ id: z.string() }), async (ctx, i) => { await CRM.winOpportunity(ctx, i.id); return { revalidate: [`/app/crm/oportunidades/${i.id}`], message: "Oportunidade ganha. Gere a proposta/pedido a partir dela." }; });
export const loseAction = makeAction(z.object({ id: z.string(), lossReasonId: z.string(), notes: z.string().optional() }), async (ctx, i) => { await CRM.loseOpportunity(ctx, i.id, i.lossReasonId, i.notes); return { revalidate: [`/app/crm/oportunidades/${i.id}`], message: "Oportunidade marcada como perdida." }; });
export const reopenAction = makeAction(z.object({ id: z.string() }), async (ctx, i) => { await CRM.reopenOpportunity(ctx, i.id); return { revalidate: [`/app/crm/oportunidades/${i.id}`] }; });
export const createActivityAction = makeAction(CRM.activitySchema.extend({ back: z.string().optional() }), async (ctx, i) => { await CRM.createActivity(ctx, i); return { revalidate: [i.back ?? "/app/crm/atividades"], message: "Atividade registrada." }; });
export const completeActivityAction = makeAction(z.object({ id: z.string(), back: z.string().optional() }), async (ctx, i) => { await CRM.completeActivity(ctx, i.id); return { revalidate: [i.back ?? "/app/crm/atividades"] }; });
export const proposalFromOpportunityAction = makeAction(z.object({ opportunityId: z.string() }), async (ctx, i) => {
  const o = await ctx.db.opportunity.findFirstOrThrow({ where: { id: i.opportunityId } });
  const p = await createProposal(ctx, { companyId: o.companyId, partyId: o.partyId, opportunityId: o.id, title: o.title, commercialModel: "TIME_MATERIAL" });
  return { redirectTo: `/app/propostas/${p.id}` };
});
