"use server";
import { z } from "zod";
import { makeAction } from "@/server/action";
import * as P from "@/modules/proposals/service";
import { createSalesOrderFromProposal } from "@/modules/contracts/service";

export const createProposalAction = makeAction(P.createProposalSchema, async (ctx, i) => { const p = await P.createProposal(ctx, i); return { redirectTo: `/app/propostas/${p.id}` }; });
export const saveDraftAction = makeAction(P.versionSchema.extend({ proposalId: z.string() }), async (ctx, i) => {
  const t = await P.saveDraft(ctx, i.proposalId, i);
  return { revalidate: [`/app/propostas/${i.proposalId}`], message: `Rascunho salvo. Receita líquida ${t.netRevenue.toFixed(2)}.` };
});
export const submitProposalAction = makeAction(z.object({ id: z.string() }), async (ctx, i) => {
  const r = await P.submitProposal(ctx, i.id);
  return { revalidate: [`/app/propostas/${i.id}`], message: r.approved ? "Aprovada automaticamente (dentro das alçadas)." : `Enviada para aprovação: ${r.matched.map((m) => m.reason).join("; ")}` };
});
export const newVersionAction = makeAction(z.object({ id: z.string() }), async (ctx, i) => { await P.newVersion(ctx, i.id); return { revalidate: [`/app/propostas/${i.id}`], message: "Nova versão criada em rascunho." }; });
export const markSentAction = makeAction(z.object({ id: z.string() }), async (ctx, i) => { await P.markSent(ctx, i.id); return { revalidate: [`/app/propostas/${i.id}`] }; });
export const acceptAction = makeAction(z.object({ id: z.string(), acceptedByName: z.string(), note: z.string().optional(), acceptedOn: z.string().optional() }), async (ctx, i) => { await P.registerAcceptance(ctx, i.id, i); return { revalidate: [`/app/propostas/${i.id}`], message: "Aceite registrado. Gere o pedido de venda." }; });
export const clientRejectAction = makeAction(z.object({ id: z.string(), reason: z.string() }), async (ctx, i) => { await P.rejectByClient(ctx, i.id, i.reason); return { revalidate: [`/app/propostas/${i.id}`] }; });
export const createOrderAction = makeAction(z.object({ id: z.string(), orderDate: z.string(), customerPo: z.string().optional() }), async (ctx, i) => {
  const so = await createSalesOrderFromProposal(ctx, i.id, { orderDate: i.orderDate, customerPo: i.customerPo || undefined });
  return { redirectTo: `/app/pedidos/${so.id}` };
});
