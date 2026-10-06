"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";
import { invite, revokeInvitation, updateMembership, setMembershipActive, saveRole } from "@/modules/users/service";
import { zArray, zBool, zOptId } from "@/lib/zod-helpers";

const inviteActionImpl = makeAction(z.object({ email: z.string().email("E-mail inválido"), roleIds: zArray, kind: z.enum(["INTERNAL", "CLIENT"]), partyId: zOptId, allCompanies: zBool, companyIds: zArray }), async (ctx, i) => {
  const { token } = await invite(ctx, i);
  const url = `/convite/${token}`;
  const devLink = process.env.APP_ENV === "production" ? "" : ` Link (somente fora de produção): ${url}`;
  return { revalidate: ["/app/admin/usuarios"], message: `Convite criado (válido por 72h) e enviado por e-mail.${devLink}` };
});
const revokeInvitationActionImpl = makeAction(z.object({ id: z.string() }), async (ctx, i) => {
  await revokeInvitation(ctx, i.id);
  return { revalidate: ["/app/admin/usuarios"] };
});
const updateMembershipActionImpl = makeAction(z.object({ id: z.string(), roleIds: zArray, allCompanies: zBool, companyIds: zArray, professionalId: zOptId }), async (ctx, i) => {
  await updateMembership(ctx, i.id, i);
  return { revalidate: ["/app/admin/usuarios"], message: "Acesso atualizado. Sessões do usuário foram encerradas para aplicar as mudanças." };
});
const toggleMembershipActionImpl = makeAction(z.object({ id: z.string(), active: z.enum(["true", "false"]) }), async (ctx, i) => {
  await setMembershipActive(ctx, i.id, i.active === "true");
  return { revalidate: ["/app/admin/usuarios"] };
});
const saveRoleActionImpl = makeAction(z.object({ id: z.string().optional(), name: z.string().min(2), description: z.string().optional(), permissions: zArray }), async (ctx, i) => {
  await saveRole(ctx, i.id || null, i);
  return { revalidate: ["/app/admin/perfis"], message: "Perfil salvo." };
});

export async function inviteAction(prev: ActionState | undefined, fd: FormData) {
  return inviteActionImpl(prev, fd);
}
export async function revokeInvitationAction(prev: ActionState | undefined, fd: FormData) {
  return revokeInvitationActionImpl(prev, fd);
}
export async function updateMembershipAction(prev: ActionState | undefined, fd: FormData) {
  return updateMembershipActionImpl(prev, fd);
}
export async function toggleMembershipAction(prev: ActionState | undefined, fd: FormData) {
  return toggleMembershipActionImpl(prev, fd);
}
export async function saveRoleAction(prev: ActionState | undefined, fd: FormData) {
  return saveRoleActionImpl(prev, fd);
}
