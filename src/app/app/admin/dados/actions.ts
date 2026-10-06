"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";
import { requestDataExport } from "@/modules/saas/data-export";
import { grantSupportAccess, revokeSupportAccess } from "@/modules/saas/support";

const exportDataActionImpl = makeAction(z.object({}), async (ctx) => {
  await requestDataExport(ctx);
  return { revalidate: ["/app/admin/dados"], message: "Exportação gerada." };
});
const grantSupportActionImpl = makeAction(z.object({ email: z.string().email(), hours: z.coerce.number().int(), reason: z.string() }), async (ctx, i) => {
  await grantSupportAccess(ctx, i.email, i.hours, i.reason);
  return { revalidate: ["/app/admin/dados"], message: "Acesso de suporte autorizado." };
});
const revokeSupportActionImpl = makeAction(z.object({ id: z.string() }), async (ctx, i) => {
  await revokeSupportAccess(ctx, i.id);
  return { revalidate: ["/app/admin/dados"], message: "Acesso revogado." };
});

export async function exportDataAction(prev: ActionState | undefined, fd: FormData) {
  return exportDataActionImpl(prev, fd);
}
export async function grantSupportAction(prev: ActionState | undefined, fd: FormData) {
  return grantSupportActionImpl(prev, fd);
}
export async function revokeSupportAction(prev: ActionState | undefined, fd: FormData) {
  return revokeSupportActionImpl(prev, fd);
}
