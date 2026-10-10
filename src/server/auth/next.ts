import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSession } from "@/modules/auth/service";
import { buildCtx, type Ctx } from "../context";
import { prisma } from "../db";
import { randomUUID } from "node:crypto";

export const SESSION_COOKIE = "erp_session";

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
}
export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}
export async function getSessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function requestMeta() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "local", userAgent: h.get("user-agent") ?? undefined };
}

export const getSession = cache(async () => resolveSession(await getSessionToken()));

/** Acesso efetivo do usuário da requisição, disponível de forma síncrona depois que o contexto foi carregado. */
export const requestAccess = cache((): { perms: Set<string>; modules: string[] } | { perms: null; modules: null } => ({ perms: null, modules: null }));

/** Contexto da requisição atual (memoizado por requisição). */
export const getCtx = cache(async (): Promise<Ctx | null> => {
  const s = await getSession();
  if (!s || s.mfaPending || !s.organizationId) return null;
  try {
    const h = await headers();
    const ctx = await buildCtx(s.userId, s.organizationId, { support: !!s.supportGrantId, correlationId: h.get("x-correlation-id") ?? randomUUID() });
    Object.assign(requestAccess(), { perms: ctx.permissions, modules: ctx.planModules });
    return ctx;
  } catch {
    return null;
  }
});

/** Exige usuário autenticado com organização ativa; redireciona conforme o caso. */
export async function requireCtx(): Promise<Ctx> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.mfaPending) redirect("/mfa");
  if (!s.organizationId) {
    if (s.user.isPlatformAdmin) redirect("/plataforma");
    redirect("/sem-organizacao");
  }
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  return ctx;
}

export async function requireInternalCtx(): Promise<Ctx> {
  const ctx = await requireCtx();
  if (ctx.kind === "CLIENT") redirect("/portal");
  return ctx;
}

export async function requirePlatformAdmin() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.mfaPending) redirect("/mfa");
  if (!s.user.isPlatformAdmin) redirect("/app");
  return s.user;
}

export async function userOrganizations(userId: string) {
  const ms = await prisma.membership.findMany({ where: { userId, active: true } });
  const orgs = await prisma.organization.findMany({ where: { id: { in: ms.map((m) => m.organizationId) } } });
  return orgs.map((o) => ({ id: o.id, name: o.name, status: o.status }));
}
