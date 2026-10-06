import { prisma } from "@/server/db";
import { requirePerm, requireWritable, type Ctx } from "@/server/context";
import { audit, diff } from "@/server/audit";
import { createInvitation } from "../auth/service";
import { assertUserLimit } from "../saas/limits";
import { conflict, notFound, rule, validation } from "@/lib/errors";
import { isPermission } from "@/lib/permissions";

export async function listMembers(ctx: Ctx) {
  requirePerm(ctx, "users.manage");
  const ms = await ctx.db.membership.findMany({ orderBy: { createdAt: "asc" } });
  const users = await prisma.user.findMany({ where: { id: { in: ms.map((m) => m.userId) } } });
  const um = new Map(users.map((u) => [u.id, u]));
  return ms.map((m) => ({ ...m, user: { id: m.userId, name: um.get(m.userId)?.name ?? "?", email: um.get(m.userId)?.email ?? "?", mfaEnabled: um.get(m.userId)?.mfaEnabled ?? false, lastLoginAt: um.get(m.userId)?.lastLoginAt ?? null } }));
}

export async function invite(ctx: Ctx, i: { email: string; roleIds: string[]; kind: "INTERNAL" | "CLIENT"; partyId?: string; allCompanies: boolean; companyIds: string[] }) {
  requirePerm(ctx, "users.manage");
  requireWritable(ctx);
  if (i.kind === "CLIENT") {
    if (!i.partyId || !(await ctx.db.party.findFirst({ where: { id: i.partyId, OR: [{ isCustomer: true }, { isProspect: true }] } }))) throw validation("Selecione o cliente do portal.");
    const roles = await ctx.db.role.findMany({ where: { id: { in: i.roleIds } } });
    if (roles.some((r) => r.permissions.some((p) => !p.startsWith("portal.")))) throw validation("Usuários do portal só podem receber perfis de portal.");
  }
  for (const c of i.companyIds) if (!(await ctx.db.company.findFirst({ where: { id: c } }))) throw validation("Empresa inválida.");
  const r = await createInvitation({ orgId: ctx.orgId, invitedById: ctx.userId, ...i, allCompanies: i.allCompanies || i.companyIds.length === 0 });
  await audit(ctx, { action: "invitation.create", entity: "Invitation", entityId: r.invitation.id, changes: { email: i.email, roles: i.roleIds, kind: i.kind } });
  return r;
}

export async function revokeInvitation(ctx: Ctx, id: string) {
  requirePerm(ctx, "users.manage");
  const inv = await ctx.db.invitation.findFirst({ where: { id } });
  if (!inv) throw notFound("Convite");
  await ctx.db.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit(ctx, { action: "invitation.revoke", entity: "Invitation", entityId: id });
}

async function orgAdminCount(ctx: Ctx, exceptMembershipId?: string) {
  const adminRole = await ctx.db.role.findFirst({ where: { key: "org_admin" } });
  if (!adminRole) return 0;
  return ctx.db.membership.count({ where: { active: true, roleIds: { has: adminRole.id }, ...(exceptMembershipId ? { NOT: { id: exceptMembershipId } } : {}) } });
}

export async function updateMembership(ctx: Ctx, id: string, i: { roleIds: string[]; allCompanies: boolean; companyIds: string[]; professionalId?: string | null }) {
  requirePerm(ctx, "users.manage");
  requireWritable(ctx);
  const m = await ctx.db.membership.findFirst({ where: { id } });
  if (!m) throw notFound("Usuário");
  const roles = await ctx.db.role.findMany({ where: { id: { in: i.roleIds } } });
  if (roles.length !== i.roleIds.length || !roles.length) throw validation("Selecione ao menos um perfil válido.");
  const adminRole = await ctx.db.role.findFirst({ where: { key: "org_admin" } });
  if (adminRole && m.roleIds.includes(adminRole.id) && !i.roleIds.includes(adminRole.id) && (await orgAdminCount(ctx, id)) === 0) throw rule("A organização precisa de ao menos um administrador.");
  if (m.kind === "CLIENT" && roles.some((r) => r.permissions.some((p) => !p.startsWith("portal.")))) throw validation("Usuários do portal só podem receber perfis de portal.");
  if (i.professionalId && !(await ctx.db.professional.findFirst({ where: { id: i.professionalId } }))) throw validation("Profissional inválido.");
  const after = await ctx.db.membership.update({ where: { id }, data: { roleIds: i.roleIds, allCompanies: i.allCompanies || i.companyIds.length === 0, companyIds: i.allCompanies ? [] : i.companyIds, professionalId: i.professionalId ?? m.professionalId } });
  await audit(ctx, { action: "membership.update", entity: "Membership", entityId: id, changes: diff({ roles: m.roleIds.join(","), companies: m.allCompanies ? "ALL" : m.companyIds.join(",") }, { roles: after.roleIds.join(","), companies: after.allCompanies ? "ALL" : after.companyIds.join(",") }) });
  await prisma.session.deleteMany({ where: { userId: m.userId, organizationId: ctx.orgId, NOT: { userId: ctx.userId } } });
}

export async function setMembershipActive(ctx: Ctx, id: string, active: boolean) {
  requirePerm(ctx, "users.manage");
  requireWritable(ctx);
  const m = await ctx.db.membership.findFirst({ where: { id } });
  if (!m) throw notFound("Usuário");
  if (m.userId === ctx.userId && !active) throw rule("Você não pode desativar o próprio acesso.");
  if (!active && (await orgAdminCount(ctx, id)) === 0) {
    const adminRole = await ctx.db.role.findFirst({ where: { key: "org_admin" } });
    if (adminRole && m.roleIds.includes(adminRole.id)) throw rule("A organização precisa de ao menos um administrador ativo.");
  }
  if (active && m.kind === "INTERNAL") await assertUserLimit(ctx.orgId, 1);
  await ctx.db.membership.update({ where: { id }, data: { active } });
  if (!active) await prisma.session.deleteMany({ where: { userId: m.userId, organizationId: ctx.orgId } });
  await audit(ctx, { action: active ? "membership.activate" : "membership.deactivate", entity: "Membership", entityId: id });
}

export async function saveRole(ctx: Ctx, id: string | null, i: { key?: string; name: string; description?: string; permissions: string[] }) {
  requirePerm(ctx, "users.manage");
  requireWritable(ctx);
  const perms = i.permissions.filter(isPermission);
  if (perms.length !== i.permissions.length) throw validation("Permissão desconhecida.");
  if (id) {
    const r = await ctx.db.role.findFirst({ where: { id } });
    if (!r) throw notFound("Perfil");
    if (r.key === "org_admin") throw rule("O perfil Administrador da organização não pode ser alterado.");
    const portal = r.key.startsWith("client_");
    if (portal && perms.some((p) => !p.startsWith("portal."))) throw rule("Perfis de portal só podem conter permissões de portal.");
    await ctx.db.role.update({ where: { id }, data: { name: i.name, description: i.description ?? null, permissions: perms } });
    const added = perms.filter((p) => !r.permissions.includes(p as string));
    const removed = r.permissions.filter((p) => !(perms as string[]).includes(p));
    await audit(ctx, { action: "role.update", entity: "Role", entityId: id, changes: { added, removed } });
    return;
  }
  const key = (i.key ?? i.name).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").slice(0, 40);
  if (await ctx.db.role.findFirst({ where: { key } })) throw conflict("Já existe perfil com esta chave.");
  const r = await ctx.db.role.create({ data: { organizationId: ctx.orgId, key, name: i.name, description: i.description ?? null, permissions: perms } });
  await audit(ctx, { action: "role.create", entity: "Role", entityId: r.id, changes: { permissions: perms } });
}
