"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";
import * as S from "@/modules/procurement/service";

const createRequisitionActionImpl = makeAction(S.requisitionSchema, async (ctx, i) => { const r = await S.createRequisition(ctx, i); return { redirectTo: `/app/suprimentos/requisicoes/${r.id}` }; });
const submitRequisitionActionImpl = makeAction(z.object({ id: z.string() }), async (ctx, i) => { const a = await S.submitRequisition(ctx, i.id); return { revalidate: [`/app/suprimentos/requisicoes/${i.id}`], message: a ? "Requisição aprovada (sem alçada aplicável)." : "Enviada para aprovação." }; });
const addQuotationActionImpl = makeAction(S.quotationSchema, async (ctx, i) => { await S.addQuotation(ctx, i); return { revalidate: [`/app/suprimentos/requisicoes/${i.requisitionId}`], message: "Cotação registrada." }; });
const createPoActionImpl = makeAction(S.poSchema, async (ctx, i) => { const po = await S.createPurchaseOrder(ctx, i); return { redirectTo: `/app/suprimentos/pedidos/${po.id}` }; });
const submitPoActionImpl = makeAction(z.object({ id: z.string() }), async (ctx, i) => { const r = await S.submitPurchaseOrder(ctx, i.id); return { revalidate: [`/app/suprimentos/pedidos/${i.id}`], message: `${r.approved ? "Pedido aprovado." : "Pedido enviado para aprovação."} Orçamento: ${r.check.scope} — disponível ${r.check.available} (${r.check.ok ? "suficiente" : "INSUFICIENTE"}).` }; });
const cancelPoActionImpl = makeAction(z.object({ id: z.string(), reason: z.string() }), async (ctx, i) => { await S.cancelPurchaseOrder(ctx, i.id, i.reason); return { revalidate: [`/app/suprimentos/pedidos/${i.id}`] }; });
const closePoActionImpl = makeAction(z.object({ id: z.string(), reason: z.string() }), async (ctx, i) => { await S.closePurchaseOrder(ctx, i.id, i.reason); return { revalidate: [`/app/suprimentos/pedidos/${i.id}`], message: "Saldo encerrado." }; });
const receiptActionImpl = makeAction(S.receiptSchema, async (ctx, i) => { await S.postReceipt(ctx, i); return { revalidate: [`/app/suprimentos/pedidos/${i.purchaseOrderId}`], message: "Recebimento/aceite registrado." }; });
const supplierInvoiceActionImpl = makeAction(S.supplierInvoiceSchema, async (ctx, i) => { const r = await S.registerSupplierInvoice(ctx, i); return { revalidate: [`/app/suprimentos/pedidos/${i.purchaseOrderId}`, "/app/suprimentos/notas"], message: r.match.ok ? "Documento conferido (3 vias) e conta a pagar gerada para aprovação financeira." : `Documento DIVERGENTE: ${r.match.divergences.join(" ")}` }; });
const acceptDivergenceActionImpl = makeAction(z.object({ id: z.string(), reason: z.string() }), async (ctx, i) => { await S.acceptDivergence(ctx, i.id, i.reason); return { revalidate: ["/app/suprimentos/notas"], message: "Divergência aceita e conta a pagar gerada." }; });
const cancelInvoiceActionImpl = makeAction(z.object({ id: z.string(), reason: z.string() }), async (ctx, i) => { await S.cancelSupplierInvoice(ctx, i.id, i.reason); return { revalidate: ["/app/suprimentos/notas"], message: "Documento cancelado." }; });
const evaluateActionImpl = makeAction(S.evaluationSchema, async (ctx, i) => { await S.evaluateSupplier(ctx, i); return { revalidate: ["/app/suprimentos/pedidos"], message: "Avaliação registrada." }; });
const complianceActionImpl = makeAction(S.complianceSchema.extend({ back: z.string() }), async (ctx, i) => { await S.addComplianceDoc(ctx, i); return { revalidate: [i.back], message: "Documento registrado." }; });
const assetMoveActionImpl = makeAction(S.assetMoveSchema, async (ctx, i) => { await S.moveAsset(ctx, i); return { revalidate: ["/app/suprimentos/ativos"], message: "Movimentação registrada." }; });

export async function createRequisitionAction(prev: ActionState | undefined, fd: FormData) {
  return createRequisitionActionImpl(prev, fd);
}
export async function submitRequisitionAction(prev: ActionState | undefined, fd: FormData) {
  return submitRequisitionActionImpl(prev, fd);
}
export async function addQuotationAction(prev: ActionState | undefined, fd: FormData) {
  return addQuotationActionImpl(prev, fd);
}
export async function createPoAction(prev: ActionState | undefined, fd: FormData) {
  return createPoActionImpl(prev, fd);
}
export async function submitPoAction(prev: ActionState | undefined, fd: FormData) {
  return submitPoActionImpl(prev, fd);
}
export async function cancelPoAction(prev: ActionState | undefined, fd: FormData) {
  return cancelPoActionImpl(prev, fd);
}
export async function closePoAction(prev: ActionState | undefined, fd: FormData) {
  return closePoActionImpl(prev, fd);
}
export async function receiptAction(prev: ActionState | undefined, fd: FormData) {
  return receiptActionImpl(prev, fd);
}
export async function supplierInvoiceAction(prev: ActionState | undefined, fd: FormData) {
  return supplierInvoiceActionImpl(prev, fd);
}
export async function acceptDivergenceAction(prev: ActionState | undefined, fd: FormData) {
  return acceptDivergenceActionImpl(prev, fd);
}
export async function cancelInvoiceAction(prev: ActionState | undefined, fd: FormData) {
  return cancelInvoiceActionImpl(prev, fd);
}
export async function evaluateAction(prev: ActionState | undefined, fd: FormData) {
  return evaluateActionImpl(prev, fd);
}
export async function complianceAction(prev: ActionState | undefined, fd: FormData) {
  return complianceActionImpl(prev, fd);
}
export async function assetMoveAction(prev: ActionState | undefined, fd: FormData) {
  return assetMoveActionImpl(prev, fd);
}
