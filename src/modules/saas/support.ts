import { prisma } from "@/server/db";
import { requirePerm, type Ctx } from "@/server/context";
import { audit, auditPlatform } from "@/server/audit";
import { forbidden, notFound, validation } from "@/lib/errors";
import { createSession } from "../auth/service";

/** Organização autoriza acesso temporário de um usuário de suporte da plataforma (somente leitura). */
export async function grantSupportAccess(ctx: Ctx, platformUserEmail: string, hours: number, reason: string) {
  requirePerm(ctx, "support.grant");
  if (!reason.trim()) throw validation("Informe o motivo.");
  if (!(hours >= 1 && hours <= 72)) throw validation("Duração entre 1 e 72 horas.");
  const user = await prisma.user.findUnique({ where: { email: platformUserEmail.trim().toLowerCase() } });
  if (!user || !user.isPlatformAdmin) throw validation("Usuário de suporte da plataforma não encontrado.");
  const g = await ctx.db.supportAccessGrant.create({ data: { organizationId: ctx.orgId, platformUserId: user.id, grantedById: ctx.userId, reason, expiresAt: new Date(Date.now() + hours * 3600000) } });
  await audit(ctx, { action: "support.grant", entity: "SupportAccessGrant", entityId: g.id, reason, changes: { platformUser: user.email, hours } });
  return g;
}

export async function revokeSupportAccess(ctx: Ctx, id: string) {
  requirePerm(ctx, "support.grant");
  const g = await ctx.db.supportAccessGrant.findFirst({ where: { id } });
  if (!g) throw notFound("Concessão");
  await ctx.db.supportAccessGrant.update({ where: { id }, data: { revokedAt: new Date() } });
  await prisma.session.deleteMany({ where: { supportGrantId: id } });
  await audit(ctx, { action: "support.revoke", entity: "SupportAccessGrant", entityId: id });
}

/** Usuário da plataforma inicia sessão de suporte (exige concessão vigente). */
export async function startSupportSession(platformUserId: string, orgId: string, meta: { ip?: string; userAgent?: string }) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: platformUserId } });
  if (!user.isPlatformAdmin) throw forbidden();
  const grant = await prisma.supportAccessGrant.findFirst({ where: { organizationId: orgId, platformUserId, revokedAt: null, expiresAt: { gt: new Date() } } });
  if (!grant) throw forbidden("Não há autorização de suporte vigente para esta organização.");
  const token = await createSession(platformUserId, orgId, { ...meta, supportGrantId: grant.id });
  // Expira junto com a concessão
  await prisma.session.updateMany({ where: { supportGrantId: grant.id, userId: platformUserId }, data: { expiresAt: grant.expiresAt } });
  await auditPlatform(platformUserId, "support.session_start", "Organization", orgId, { grantId: grant.id }, orgId);
  return token;
}
