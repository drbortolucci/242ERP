"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";
import { activateSubscription, changePlan, cancelSubscription, reactivate } from "@/modules/saas/subscription";

const activateActionImpl = makeAction(z.object({}), async (ctx) => {
  await activateSubscription(ctx);
  return { revalidate: ["/app/admin/assinatura"], message: "Assinatura ativada (provedor simulado)." };
});
const changePlanActionImpl = makeAction(z.object({ planId: z.string() }), async (ctx, i) => {
  const r = await changePlan(ctx, i.planId);
  return { revalidate: ["/app/admin/assinatura"], message: r.isUpgrade ? "Upgrade aplicado imediatamente." : "Downgrade agendado para o fim do ciclo atual (ou imediato durante a avaliação)." };
});
const cancelActionImpl = makeAction(z.object({ reason: z.string() }), async (ctx, i) => {
  await cancelSubscription(ctx, i.reason);
  return { revalidate: ["/app/admin/assinatura"], message: "Cancelamento registrado." };
});
const reactivateActionImpl = makeAction(z.object({}), async (ctx) => {
  await reactivate(ctx);
  return { revalidate: ["/app/admin/assinatura"], message: "Assinatura reativada." };
});

export async function activateAction(prev: ActionState | undefined, fd: FormData) {
  return activateActionImpl(prev, fd);
}
export async function changePlanAction(prev: ActionState | undefined, fd: FormData) {
  return changePlanActionImpl(prev, fd);
}
export async function cancelAction(prev: ActionState | undefined, fd: FormData) {
  return cancelActionImpl(prev, fd);
}
export async function reactivateAction(prev: ActionState | undefined, fd: FormData) {
  return reactivateActionImpl(prev, fd);
}
