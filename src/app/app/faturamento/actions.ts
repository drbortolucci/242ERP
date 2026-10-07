"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";
import * as M from "@/modules/billing/measurement";
import * as I from "@/modules/billing/invoice";
import * as F from "@/modules/billing/fiscal";

const mp = (id: string) => `/app/faturamento/medicoes/${id}`;
const createMeasurementActionImpl = makeAction(M.measurementSchema, async (ctx, i) => { const m = await M.createMeasurement(ctx, i); return { redirectTo: mp(m.id) }; });
const submitMeasurementActionImpl = makeAction(z.object({ id: z.string() }), async (ctx, i) => { const a = await M.submitMeasurement(ctx, i.id); return { revalidate: [mp(i.id)], message: a ? "Medição aprovada (sem alçada aplicável)." : "Medição enviada para aprovação." }; });
const adjustmentActionImpl = makeAction(z.object({ id: z.string(), description: z.string(), amount: z.string() }), async (ctx, i) => { await M.addAdjustment(ctx, i.id, i.description, i.amount.replace(",", ".")); return { revalidate: [mp(i.id)], message: "Ajuste incluído." }; });
const removeItemActionImpl = makeAction(z.object({ id: z.string(), itemId: z.string() }), async (ctx, i) => { await M.removeItem(ctx, i.itemId); return { revalidate: [mp(i.id)], message: "Item removido e origem liberada." }; });
const cancelMeasurementActionImpl = makeAction(z.object({ id: z.string(), reason: z.string() }), async (ctx, i) => { await M.cancelMeasurement(ctx, i.id, i.reason); return { revalidate: [mp(i.id)], message: "Medição cancelada; origens liberadas." }; });
const clientApproveActionImpl = makeAction(z.object({ id: z.string(), byName: z.string() }), async (ctx, i) => { await M.clientApproveMeasurement(ctx, i.id, i.byName); return { revalidate: [mp(i.id)], message: "Aprovação do cliente registrada." }; });
const invoiceActionImpl = makeAction(I.invoiceSchema, async (ctx, i) => { const d = await I.invoiceMeasurement(ctx, i); return { redirectTo: `/app/faturamento/cobrancas/${d.id}` }; });
const cancelInvoiceDocActionImpl = makeAction(z.object({ id: z.string(), reason: z.string() }), async (ctx, i) => { await I.cancelBillingDocument(ctx, i.id, i.reason); return { revalidate: [`/app/faturamento/cobrancas/${i.id}`], message: "Documento cancelado; itens devolvidos à medição." }; });
const requestFiscalActionImpl = makeAction(z.object({ id: z.string() }), async (ctx, i) => {
  const fd = await F.requestFiscalDocument(ctx, i.id);
  await F.processFiscalDocument(fd.id).catch(() => undefined); // processa já (a fila repete em caso de falha)
  return { revalidate: [`/app/faturamento/cobrancas/${i.id}`], message: "Solicitação enviada ao provedor fiscal." };
});

export async function createMeasurementAction(prev: ActionState | undefined, fd: FormData) {
  return createMeasurementActionImpl(prev, fd);
}
export async function submitMeasurementAction(prev: ActionState | undefined, fd: FormData) {
  return submitMeasurementActionImpl(prev, fd);
}
export async function adjustmentAction(prev: ActionState | undefined, fd: FormData) {
  return adjustmentActionImpl(prev, fd);
}
export async function removeItemAction(prev: ActionState | undefined, fd: FormData) {
  return removeItemActionImpl(prev, fd);
}
export async function cancelMeasurementAction(prev: ActionState | undefined, fd: FormData) {
  return cancelMeasurementActionImpl(prev, fd);
}
export async function clientApproveAction(prev: ActionState | undefined, fd: FormData) {
  return clientApproveActionImpl(prev, fd);
}
export async function invoiceAction(prev: ActionState | undefined, fd: FormData) {
  return invoiceActionImpl(prev, fd);
}
export async function cancelInvoiceDocAction(prev: ActionState | undefined, fd: FormData) {
  return cancelInvoiceDocActionImpl(prev, fd);
}
export async function requestFiscalAction(prev: ActionState | undefined, fd: FormData) {
  return requestFiscalActionImpl(prev, fd);
}
