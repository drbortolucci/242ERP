"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { login, completeMfa, requestPasswordReset, resetPassword, acceptInvitation, createSession, getInvitation } from "@/modules/auth/service";
import { provisionOrganization } from "@/modules/saas/provision";
import { setSessionCookie, getSessionToken, requestMeta, getSession } from "@/server/auth/next";
import { toAppError } from "@/lib/errors";
import type { ActionState } from "@/server/action";
import { formToObject } from "@/server/action";

function fail(e: unknown): ActionState {
  return { ok: false, error: toAppError(e).message };
}

export async function loginAction(_: ActionState | undefined, fd: FormData): Promise<ActionState> {
  const { email, password, next } = formToObject(fd) as Record<string, string>;
  let mfa = false;
  try {
    const r = await login(email ?? "", password ?? "", await requestMeta());
    await setSessionCookie(r.token);
    mfa = r.mfaRequired;
  } catch (e) {
    return fail(e);
  }
  redirect(mfa ? "/mfa" : next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function mfaAction(_: ActionState | undefined, fd: FormData): Promise<ActionState> {
  try {
    const token = await getSessionToken();
    await completeMfa(token ?? "", String(fd.get("code") ?? ""));
  } catch (e) {
    return fail(e);
  }
  redirect("/");
}

const signupSchema = z.object({
  orgName: z.string().trim().min(2, "Informe o nome da organização"),
  userName: z.string().trim().min(2, "Informe seu nome"),
  email: z.string().trim().email("E-mail inválido"),
  password: z.string().min(10, "Mínimo de 10 caracteres"),
  planCode: z.string().min(1),
  accept: z.literal("on", { errorMap: () => ({ message: "É necessário aceitar os termos de uso e a política de privacidade" }) }),
});

export async function signupAction(_: ActionState | undefined, fd: FormData): Promise<ActionState> {
  try {
    const input = signupSchema.parse(formToObject(fd));
    const { user, org } = await provisionOrganization(input);
    const token = await createSession(user.id, org.id, await requestMeta());
    await setSessionCookie(token);
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues.map((i) => i.message).join(" · ") };
    return fail(e);
  }
  redirect("/app/onboarding");
}

export async function forgotAction(_: ActionState | undefined, fd: FormData): Promise<ActionState> {
  try {
    await requestPasswordReset(String(fd.get("email") ?? ""), (await requestMeta()).ip);
  } catch (e) {
    return fail(e);
  }
  return { ok: true, message: "Se o e-mail estiver cadastrado, enviaremos um link de redefinição válido por 1 hora." };
}

export async function resetAction(_: ActionState | undefined, fd: FormData): Promise<ActionState> {
  const pw = String(fd.get("password") ?? "");
  if (pw !== String(fd.get("confirm") ?? "")) return { ok: false, error: "As senhas não conferem." };
  try {
    await resetPassword(String(fd.get("token") ?? ""), pw);
  } catch (e) {
    return fail(e);
  }
  redirect("/login?reset=1");
}

export async function acceptInviteAction(_: ActionState | undefined, fd: FormData): Promise<ActionState> {
  const token = String(fd.get("token") ?? "");
  try {
    const found = await getInvitation(token);
    if (!found) return { ok: false, error: "Convite inválido ou expirado." };
    const session = await getSession();
    const u = await acceptInvitation(token, { name: String(fd.get("name") ?? ""), password: String(fd.get("password") ?? ""), existingUserId: session?.userId });
    const t = await createSession(u.id, found.inv.organizationId, await requestMeta());
    await setSessionCookie(t);
  } catch (e) {
    return fail(e);
  }
  redirect("/");
}
