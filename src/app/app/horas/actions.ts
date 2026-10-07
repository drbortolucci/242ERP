"use server";
import { z } from "zod";
import { makeAction } from "@/server/action";
import * as T from "@/modules/timesheet/service";
import { zArray } from "@/lib/zod-helpers";

export const createEntryAction = makeAction(T.timeEntrySchema, async (ctx, i) => { await T.createTimeEntry(ctx, i); return { revalidate: ["/app/horas"], message: "Apontamento registrado como rascunho." }; });
export const submitEntriesAction = makeAction(z.object({ ids: zArray }), async (ctx, i) => { const n = await T.submitEntries(ctx, i.ids); return { revalidate: ["/app/horas"], message: `${n} apontamento(s) enviado(s) para aprovação.` }; });
export const deleteEntryAction = makeAction(z.object({ id: z.string() }), async (ctx, i) => { await T.deleteDraftEntry(ctx, i.id); return { revalidate: ["/app/horas"] }; });
export const approveEntriesAction = makeAction(z.object({ ids: zArray, decision: z.enum(["approve", "reject", "client"]), reason: z.string().optional(), byName: z.string().optional() }), async (ctx, i) => {
  if (!i.ids.length) throw new Error("Selecione ao menos um apontamento.");
  if (i.decision === "approve") return { revalidate: ["/app/horas/aprovacao"], message: `${await T.approveEntries(ctx, i.ids)} aprovado(s).` };
  if (i.decision === "client") return { revalidate: ["/app/horas/aprovacao"], message: `${await T.clientDecision(ctx, i.ids, true, i.byName || "Cliente (registrado internamente)")} aprovação(ões) do cliente registrada(s).` };
  return { revalidate: ["/app/horas/aprovacao"], message: `${await T.rejectEntries(ctx, i.ids, i.reason ?? "")} rejeitado(s).` };
});
export const adjustmentAction = makeAction(z.object({ id: z.string(), delta: z.string(), reason: z.string() }), async (ctx, i) => { await T.createAdjustment(ctx, i.id, i.delta.replace(",", "."), i.reason); return { revalidate: ["/app/horas/aprovacao"], message: "Ajuste rastreável criado." }; });
