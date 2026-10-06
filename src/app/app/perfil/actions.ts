"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";
import { changePassword, beginMfaSetup, confirmMfaSetup, disableMfa } from "@/modules/auth/service";
import { prisma } from "@/server/db";

const changePasswordActionImpl = makeAction(z.object({ current: z.string(), next: z.string(), confirm: z.string() }), async (ctx, i) => {
  if (i.next !== i.confirm) throw new Error("As senhas não conferem.");
  await changePassword(ctx.userId, i.current, i.next);
  return { message: "Senha alterada." };
});
const beginMfaActionImpl = makeAction(z.object({}), async (ctx) => {
  await beginMfaSetup(ctx.userId);
  return { revalidate: ["/app/perfil"], message: "Escaneie o código no aplicativo autenticador e confirme." };
});
const confirmMfaActionImpl = makeAction(z.object({ code: z.string() }), async (ctx, i) => {
  await confirmMfaSetup(ctx.userId, i.code);
  return { revalidate: ["/app/perfil"], message: "Autenticação em duas etapas ativada." };
});
const disableMfaActionImpl = makeAction(z.object({ password: z.string() }), async (ctx, i) => {
  await disableMfa(ctx.userId, i.password);
  return { revalidate: ["/app/perfil"], message: "Autenticação em duas etapas desativada." };
});
const savePrefsActionImpl = makeAction(z.object({ dashboard: z.string().optional(), pageSize: z.coerce.number().int().min(10).max(200) }), async (ctx, i) => {
  await prisma.user.update({ where: { id: ctx.userId }, data: { preferences: { dashboard: i.dashboard ?? "auto", pageSize: i.pageSize } } });
  return { message: "Preferências salvas." };
});

export async function changePasswordAction(prev: ActionState | undefined, fd: FormData) {
  return changePasswordActionImpl(prev, fd);
}
export async function beginMfaAction(prev: ActionState | undefined, fd: FormData) {
  return beginMfaActionImpl(prev, fd);
}
export async function confirmMfaAction(prev: ActionState | undefined, fd: FormData) {
  return confirmMfaActionImpl(prev, fd);
}
export async function disableMfaAction(prev: ActionState | undefined, fd: FormData) {
  return disableMfaActionImpl(prev, fd);
}
export async function savePrefsAction(prev: ActionState | undefined, fd: FormData) {
  return savePrefsActionImpl(prev, fd);
}
