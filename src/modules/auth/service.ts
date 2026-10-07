import { prisma } from "@/server/db";
import { hashPassword, randomToken, sha256, validatePasswordStrength, verifyPassword } from "@/server/auth/crypto";
import { generateTotpSecret, verifyTotp } from "@/server/auth/totp";
import { rateLimit } from "@/server/auth/rate-limit";
import { AppError, validation, forbidden, conflict } from "@/lib/errors";
import { auditPlatform } from "@/server/audit";
import { sendEmail } from "@/server/providers/email";
import { assertUserLimit } from "../saas/limits";

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;

export interface LoginResult {
  token: string;
  mfaRequired: boolean;
}

export async function createSession(userId: string, organizationId: string | null, meta: { ip?: string; userAgent?: string; mfaPending?: boolean; supportGrantId?: string } = {}) {
  const token = randomToken(32);
  await prisma.session.create({
    data: {
      tokenHash: sha256(token), userId, organizationId, mfaPending: !!meta.mfaPending, supportGrantId: meta.supportGrantId ?? null,
      ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 250) ?? null, expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return token;
}

export async function login(emailRaw: string, password: string, meta: { ip?: string; userAgent?: string } = {}): Promise<LoginResult> {
  const email = emailRaw.trim().toLowerCase();
  await rateLimit(`login:ip:${meta.ip ?? "unknown"}`, 30, 300);
  await rateLimit(`login:email:${email}`, 10, 300);
  const user = await prisma.user.findUnique({ where: { email } });
  const invalid = new AppError("UNAUTHENTICATED", "E-mail ou senha inválidos.");
  if (!user || !user.active) {
    await verifyPassword("$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$ZmFrZWhhc2g", password); // tempo constante aproximado
    throw invalid;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new AppError("RATE_LIMITED", "Conta temporariamente bloqueada por tentativas inválidas. Tente mais tarde ou recupere o acesso.");
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    const failed = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: failed, lockedUntil: failed >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60000) : null },
    });
    await auditPlatform(user.id, "auth.login_failed", "User", user.id, { ip: meta.ip });
    throw invalid;
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const firstMembership = await prisma.membership.findFirst({ where: { userId: user.id, active: true }, orderBy: { createdAt: "asc" } });
  const token = await createSession(user.id, firstMembership?.organizationId ?? null, { ...meta, mfaPending: user.mfaEnabled });
  await auditPlatform(user.id, "auth.login", "User", user.id, { ip: meta.ip, mfa: user.mfaEnabled }, firstMembership?.organizationId);
  return { token, mfaRequired: user.mfaEnabled };
}

export async function completeMfa(token: string, code: string) {
  const s = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!s || s.expiresAt < new Date()) throw new AppError("UNAUTHENTICATED", "Sessão expirada.");
  await rateLimit(`mfa:${s.userId}`, 10, 300);
  if (!s.user.mfaSecret || !verifyTotp(s.user.mfaSecret, code)) throw validation("Código inválido.");
  await prisma.session.update({ where: { id: s.id }, data: { mfaPending: false } });
}

export async function resolveSession(token: string | undefined | null) {
  if (!token) return null;
  const s = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!s || s.expiresAt < new Date() || !s.user.active) return null;
  // Renovação deslizante (no máximo a cada 5 min para reduzir escrita)
  if (Date.now() - s.lastSeenAt.getTime() > 5 * 60000) {
    await prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
  }
  return s;
}

export async function logout(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

export async function switchOrganization(token: string, orgId: string) {
  const s = await resolveSession(token);
  if (!s) throw new AppError("UNAUTHENTICATED", "Sessão expirada.");
  const m = await prisma.membership.findUnique({ where: { userId_organizationId: { userId: s.userId, organizationId: orgId } } });
  if (!m || !m.active) throw forbidden("Você não pertence a esta organização.");
  await prisma.session.update({ where: { id: s.id }, data: { organizationId: orgId, supportGrantId: null } });
}

// ---------------------------------------------------------------- Recuperação de acesso

export async function requestPasswordReset(emailRaw: string, ip?: string) {
  const email = emailRaw.trim().toLowerCase();
  await rateLimit(`reset:${ip ?? "unknown"}`, 10, 900);
  const user = await prisma.user.findUnique({ where: { email } });
  // Resposta idêntica exista ou não o e-mail (evita enumeração)
  if (!user) return;
  const token = randomToken(32);
  await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60000) } });
  const url = `${process.env.APP_URL ?? "http://localhost:3000"}/redefinir-senha/${token}`;
  await sendEmail({ to: email, subject: "Redefinição de senha — 242ERP", body: `Para redefinir sua senha acesse: ${url}\nO link expira em 1 hora.` });
  await auditPlatform(user.id, "auth.reset_requested", "User", user.id);
  return token; // retornado apenas para testes; a interface não exibe
}

export async function resetPassword(token: string, newPassword: string) {
  const err = validatePasswordStrength(newPassword);
  if (err) throw validation(err);
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw validation("Link inválido ou expirado.");
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(newPassword), failedLogins: 0, lockedUntil: null } }),
    prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId: row.userId } }),
  ]);
  await auditPlatform(row.userId, "auth.password_reset", "User", row.userId);
}

export async function changePassword(userId: string, current: string, next: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(user.passwordHash, current))) throw validation("Senha atual incorreta.");
  const err = validatePasswordStrength(next);
  if (err) throw validation(err);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
  await auditPlatform(userId, "auth.password_changed", "User", userId);
}

// ---------------------------------------------------------------- MFA

export async function beginMfaSetup(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  // Nunca desativa um MFA já ativo: para trocar o autenticador, desative primeiro (exige senha).
  if (user.mfaEnabled) throw conflict("A autenticação em duas etapas já está ativa. Desative-a (com senha) antes de reconfigurar.");
  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: userId }, data: { mfaSecret: secret, mfaEnabled: false } });
  return secret;
}
export async function confirmMfaSetup(userId: string, code: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.mfaSecret || !verifyTotp(user.mfaSecret, code)) throw validation("Código inválido.");
  await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
  await auditPlatform(userId, "auth.mfa_enabled", "User", userId);
}
export async function disableMfa(userId: string, password: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(user.passwordHash, password))) throw validation("Senha incorreta.");
  await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecret: null } });
  await auditPlatform(userId, "auth.mfa_disabled", "User", userId);
}

// ---------------------------------------------------------------- Convites

export interface InviteInput {
  orgId: string;
  invitedById: string;
  email: string;
  roleIds: string[];
  kind?: "INTERNAL" | "CLIENT";
  partyId?: string | null;
  allCompanies?: boolean;
  companyIds?: string[];
  ttlHours?: number;
}

export async function createInvitation(input: InviteInput) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw validation("E-mail inválido.");
  if ((input.kind ?? "INTERNAL") === "INTERNAL") await assertUserLimit(input.orgId, 1);
  if (input.kind === "CLIENT" && !input.partyId) throw validation("Convite de portal exige o cliente autorizado.");
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const m = await prisma.membership.findUnique({ where: { userId_organizationId: { userId: existingUser.id, organizationId: input.orgId } } });
    if (m?.active) throw conflict("Este usuário já faz parte da organização.");
  }
  const roles = await prisma.role.findMany({ where: { organizationId: input.orgId, id: { in: input.roleIds } } });
  if (roles.length !== input.roleIds.length || roles.length === 0) throw validation("Perfis inválidos.");
  const token = randomToken(32);
  const inv = await prisma.invitation.create({
    data: {
      organizationId: input.orgId, email, roleIds: input.roleIds, kind: input.kind ?? "INTERNAL", partyId: input.partyId ?? null,
      allCompanies: input.allCompanies ?? true, companyIds: input.companyIds ?? [], tokenHash: sha256(token), invitedById: input.invitedById,
      expiresAt: new Date(Date.now() + (input.ttlHours ?? 72) * 3600000),
    },
  });
  const url = `${process.env.APP_URL ?? "http://localhost:3000"}/convite/${token}`;
  await sendEmail({ to: email, subject: "Convite para o 242ERP", body: `Você foi convidado(a). Aceite em: ${url}`, organizationId: input.orgId });
  return { invitation: inv, token };
}

export async function getInvitation(token: string) {
  const inv = await prisma.invitation.findUnique({ where: { tokenHash: sha256(token) } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) return null;
  const org = await prisma.organization.findUnique({ where: { id: inv.organizationId } });
  return { inv, org };
}

export async function acceptInvitation(token: string, data: { name: string; password?: string; existingUserId?: string }) {
  const found = await getInvitation(token);
  if (!found) throw validation("Convite inválido ou expirado.");
  const { inv } = found;
  if (inv.kind === "INTERNAL") await assertUserLimit(inv.organizationId, 1);
  let user = await prisma.user.findUnique({ where: { email: inv.email } });
  if (user && data.existingUserId !== user.id) throw validation("Este e-mail já possui conta. Entre com ela para aceitar o convite.");
  if (!user) {
    const err = validatePasswordStrength(data.password ?? "");
    if (err) throw validation(err);
    user = await prisma.user.create({ data: { email: inv.email, name: data.name.trim(), passwordHash: await hashPassword(data.password!) } });
  }
  const u = user;
  await prisma.$transaction(async (tx) => {
    await tx.membership.upsert({
      where: { userId_organizationId: { userId: u.id, organizationId: inv.organizationId } },
      create: { userId: u.id, organizationId: inv.organizationId, kind: inv.kind, partyId: inv.partyId, roleIds: inv.roleIds, allCompanies: inv.allCompanies, companyIds: inv.companyIds },
      update: { active: true, kind: inv.kind, partyId: inv.partyId, roleIds: inv.roleIds, allCompanies: inv.allCompanies, companyIds: inv.companyIds },
    });
    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
  });
  await auditPlatform(u.id, "invitation.accepted", "Invitation", inv.id, { roles: inv.roleIds }, inv.organizationId);
  return u;
}
