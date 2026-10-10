"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";
import * as F from "@/modules/fiscal/service";

const saveRuleImpl = makeAction(F.productRuleSchema, async (ctx, i) => { await F.saveProductRule(ctx, i); return { revalidate: ["/app/fiscal/regras"], message: i.id ? "Regra alterada: precisa ser validada novamente pelo responsável fiscal." : "Regra criada. Aguarda validação do responsável fiscal." }; });
const validateImpl = makeAction(F.validateRuleSchema, async (ctx, i) => { await F.validateProductRule(ctx, i); return { revalidate: ["/app/fiscal/regras"], message: "Validação registrada." }; });
const nfeImpl = makeAction(z.object({ id: z.string() }), async (ctx, i) => { const fd = await F.requestProductInvoice(ctx, i.id); return { revalidate: [`/app/estoque/vendas/${i.id}`, "/app/fiscal/documentos"], message: fd?.status === "AUTHORIZED" ? `NF-e autorizada: ${fd.number}.` : `NF-e ${fd?.status === "REJECTED" ? "rejeitada" : "em processamento"}${fd?.lastError ? `: ${fd.lastError}` : "."}` }; });
const cancelImpl = makeAction(F.cancelFiscalSchema, async (ctx, i) => { await F.cancelFiscalDocument(ctx, i); return { revalidate: ["/app/fiscal/documentos"], message: "Documento fiscal cancelado." }; });
const retryImpl = makeAction(z.object({ id: z.string() }), async (ctx, i) => { const fd = await F.retryFiscalDocument(ctx, i.id); return { revalidate: ["/app/fiscal/documentos"], message: `Reprocessado: ${fd?.status === "AUTHORIZED" ? "autorizado" : fd?.status === "REJECTED" ? `rejeitado${fd.lastError ? ` — ${fd.lastError}` : ""}` : "em processamento"}.` }; });

export async function saveFiscalRuleAction(prev: ActionState | undefined, fd: FormData) { return saveRuleImpl(prev, fd); }
export async function validateFiscalRuleAction(prev: ActionState | undefined, fd: FormData) { return validateImpl(prev, fd); }
export async function issueNfeAction(prev: ActionState | undefined, fd: FormData) { return nfeImpl(prev, fd); }
export async function cancelFiscalAction(prev: ActionState | undefined, fd: FormData) { return cancelImpl(prev, fd); }
export async function retryFiscalAction(prev: ActionState | undefined, fd: FormData) { return retryImpl(prev, fd); }
