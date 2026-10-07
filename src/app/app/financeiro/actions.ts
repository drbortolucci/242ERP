"use server";
import { z } from "zod";
import { makeAction, type ActionState } from "@/server/action";
import { requireCtx } from "@/server/auth/next";
import { toAppError } from "@/lib/errors";
import { revalidatePath } from "next/cache";
import * as S from "@/modules/finance/service";
import * as T from "@/modules/finance/treasury";

const tp = (kind: string, id: string) => `/app/financeiro/titulos/${kind === "RECEIVABLE" ? "receber" : "pagar"}/${id}`;
const settleActionImpl = makeAction(S.settleSchema, async (ctx, i) => { await S.settle(ctx, i); return { revalidate: [tp(i.kind, i.titleId)], message: "Liquidação registrada." }; });
const reverseSettlementActionImpl = makeAction(z.object({ id: z.string(), kind: z.string(), titleId: z.string(), reason: z.string() }), async (ctx, i) => { await S.reverseSettlement(ctx, i.id, i.reason); return { revalidate: [tp(i.kind, i.titleId)], message: "Estorno registrado (lançamento inverso vinculado)." }; });
const approvePayableActionImpl = makeAction(z.object({ id: z.string() }), async (ctx, i) => { await S.approvePayable(ctx, i.id); return { revalidate: [tp("PAYABLE", i.id), "/app/financeiro/pagar"], message: "Conta a pagar aprovada." }; });
const manualTitleActionImpl = makeAction(S.manualTitleSchema, async (ctx, i) => { const t = await S.createManualTitle(ctx, i); return { redirectTo: tp(i.kind, t.id) }; });
const advanceActionImpl = makeAction(S.advanceSchema, async (ctx, i) => { await S.registerAdvance(ctx, i); return { revalidate: ["/app/financeiro/adiantamentos"], message: "Adiantamento registrado." }; });
const applyAdvanceActionImpl = makeAction(z.object({ advanceId: z.string(), titleId: z.string(), kind: z.string(), amount: z.string() }), async (ctx, i) => { await S.applyAdvance(ctx, i.advanceId, i.titleId, i.amount.replace(",", ".")); return { revalidate: [tp(i.kind, i.titleId)], message: "Adiantamento aplicado." }; });
const reverseApplicationActionImpl = makeAction(z.object({ id: z.string(), kind: z.string(), titleId: z.string(), reason: z.string() }), async (ctx, i) => { await S.reverseAdvanceApplication(ctx, i.id, i.reason); return { revalidate: [tp(i.kind, i.titleId)], message: "Aplicação estornada." }; });
const offsetActionImpl = makeAction(S.offsetSchema.extend({ back: z.string() }), async (ctx, i) => { await S.offsetTitles(ctx, i); return { revalidate: [i.back], message: "Compensação registrada." }; });
const reverseOffsetActionImpl = makeAction(z.object({ id: z.string(), back: z.string(), reason: z.string() }), async (ctx, i) => { await S.reverseOffset(ctx, i.id, i.reason); return { revalidate: [i.back], message: "Compensação estornada." }; });
const recurringActionImpl = makeAction(S.recurringSchema, async (ctx, i) => { await S.createRecurringPayable(ctx, i); const n = await S.generateRecurringPayables(ctx); return { revalidate: ["/app/financeiro/pagar"], message: `Recorrência criada; ${n} título(s) gerado(s).` }; });
const transferActionImpl = makeAction(T.transferSchema, async (ctx, i) => { await T.transfer(ctx, i); return { revalidate: ["/app/financeiro/tesouraria"], message: "Transferência registrada." }; });
const reconcileActionImpl = makeAction(z.object({ lineId: z.string(), transactionId: z.string() }), async (ctx, i) => { await T.reconcile(ctx, i.lineId, i.transactionId); return { revalidate: ["/app/financeiro/conciliacao"], message: "Conciliado." }; });
const createFromLineActionImpl = makeAction(z.object({ lineId: z.string(), description: z.string().optional() }), async (ctx, i) => { await T.createFromLine(ctx, i.lineId, i.description ?? ""); return { revalidate: ["/app/financeiro/conciliacao"], message: "Lançamento criado e conciliado." }; });
const ignoreLineActionImpl = makeAction(z.object({ lineId: z.string(), reason: z.string() }), async (ctx, i) => { await T.ignoreLine(ctx, i.lineId, i.reason); return { revalidate: ["/app/financeiro/conciliacao"], message: "Linha ignorada." }; });
const unreconcileActionImpl = makeAction(z.object({ lineId: z.string(), reason: z.string() }), async (ctx, i) => { await T.unreconcile(ctx, i.lineId, i.reason); return { revalidate: ["/app/financeiro/conciliacao"], message: "Conciliação desfeita." }; });

/** Importação de extrato (arquivo). */
export async function importStatementAction(_prev: ActionState | undefined, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  const file = fd.get("file");
  const bankAccountId = String(fd.get("bankAccountId") ?? "");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Selecione o arquivo do extrato." };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: "Arquivo acima de 5 MB." };
  try {
    const r = await T.importStatement(ctx, bankAccountId, file.name, await file.text());
    revalidatePath("/app/financeiro/conciliacao");
    return { ok: true, message: `${r.imported} lançamento(s) importado(s); ${r.duplicates} já existente(s) ignorado(s).` };
  } catch (e) {
    return { ok: false, error: toAppError(e).message };
  }
}

export async function settleAction(prev: ActionState | undefined, fd: FormData) {
  return settleActionImpl(prev, fd);
}
export async function reverseSettlementAction(prev: ActionState | undefined, fd: FormData) {
  return reverseSettlementActionImpl(prev, fd);
}
export async function approvePayableAction(prev: ActionState | undefined, fd: FormData) {
  return approvePayableActionImpl(prev, fd);
}
export async function manualTitleAction(prev: ActionState | undefined, fd: FormData) {
  return manualTitleActionImpl(prev, fd);
}
export async function advanceAction(prev: ActionState | undefined, fd: FormData) {
  return advanceActionImpl(prev, fd);
}
export async function applyAdvanceAction(prev: ActionState | undefined, fd: FormData) {
  return applyAdvanceActionImpl(prev, fd);
}
export async function reverseApplicationAction(prev: ActionState | undefined, fd: FormData) {
  return reverseApplicationActionImpl(prev, fd);
}
export async function offsetAction(prev: ActionState | undefined, fd: FormData) {
  return offsetActionImpl(prev, fd);
}
export async function reverseOffsetAction(prev: ActionState | undefined, fd: FormData) {
  return reverseOffsetActionImpl(prev, fd);
}
export async function recurringAction(prev: ActionState | undefined, fd: FormData) {
  return recurringActionImpl(prev, fd);
}
export async function transferAction(prev: ActionState | undefined, fd: FormData) {
  return transferActionImpl(prev, fd);
}
export async function reconcileAction(prev: ActionState | undefined, fd: FormData) {
  return reconcileActionImpl(prev, fd);
}
export async function createFromLineAction(prev: ActionState | undefined, fd: FormData) {
  return createFromLineActionImpl(prev, fd);
}
export async function ignoreLineAction(prev: ActionState | undefined, fd: FormData) {
  return ignoreLineActionImpl(prev, fd);
}
export async function unreconcileAction(prev: ActionState | undefined, fd: FormData) {
  return unreconcileActionImpl(prev, fd);
}
