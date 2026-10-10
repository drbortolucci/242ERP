"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";
import * as B from "@/modules/banking/service";

const back = (id: string) => [`/app/financeiro/titulos/receber/${id}`, "/app/financeiro/cobrancas-bancarias", "/app/financeiro/receber"];
const issueImpl = makeAction(B.chargeSchema, async (ctx, i) => { const c = await B.issueCharge(ctx, i); return { revalidate: back(i.receivableId), message: `Cobrança ${c.number} emitida (${c.method === "PIX" ? "PIX" : "boleto"}).` }; });
const cancelImpl = makeAction(z.object({ id: z.string(), receivableId: z.string(), reason: z.string() }), async (ctx, i) => { await B.cancelCharge(ctx, i.id, i.reason); return { revalidate: back(i.receivableId), message: "Cobrança cancelada." }; });
const simulateImpl = makeAction(z.object({ id: z.string(), receivableId: z.string() }), async (ctx, i) => { const r = await B.simulatePayment(ctx, i.id); return { revalidate: back(i.receivableId), message: r.ok && "settlementId" in r ? "Pagamento simulado: título liquidado na conta da cobrança." : "Pagamento registrado para tratamento manual." }; });
const autoImpl = makeAction(z.object({ bankAccountId: z.string().min(1) }), async (ctx, i) => { const r = await B.autoReconcile(ctx, i.bankAccountId); return { revalidate: ["/app/financeiro/conciliacao"], message: `Conciliação automática: ${r.matched} por valor/data, ${r.byRule} por regra; ${r.remaining} para tratamento manual.` }; });
const ruleImpl = makeAction(B.ruleSchema, async (ctx, i) => { await B.saveReconciliationRule(ctx, i); return { revalidate: ["/app/financeiro/conciliacao"], message: "Regra criada." }; });
const toggleRuleImpl = makeAction(z.object({ id: z.string() }), async (ctx, i) => { await B.toggleReconciliationRule(ctx, i.id); return { revalidate: ["/app/financeiro/conciliacao"] }; });

export async function issueChargeAction(prev: ActionState | undefined, fd: FormData) { return issueImpl(prev, fd); }
export async function cancelChargeAction(prev: ActionState | undefined, fd: FormData) { return cancelImpl(prev, fd); }
export async function simulatePaymentAction(prev: ActionState | undefined, fd: FormData) { return simulateImpl(prev, fd); }
export async function autoReconcileAction(prev: ActionState | undefined, fd: FormData) { return autoImpl(prev, fd); }
export async function saveRuleAction(prev: ActionState | undefined, fd: FormData) { return ruleImpl(prev, fd); }
export async function toggleRuleAction(prev: ActionState | undefined, fd: FormData) { return toggleRuleImpl(prev, fd); }
