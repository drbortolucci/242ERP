import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import { createTenantDb, type TenantDb } from "./tenant-db";
import { AppError, forbidden } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";

export interface Ctx {
  userId: string;
  userName: string;
  userEmail: string;
  orgId: string;
  orgName: string;
  orgStatus: string;
  /** Setor de atividade (perfil/terminologia) */
  sector: string;
  timezone: string;
  currency: string;
  planModules: string[];
  membershipId: string;
  kind: "INTERNAL" | "CLIENT";
  permissions: Set<string>;
  roleKeys: string[];
  /** null = todas as empresas */
  companyIds: string[] | null;
  /** Portal do cliente: parte autorizada */
  partyId: string | null;
  professionalId: string | null;
  db: TenantDb;
  correlationId: string;
  /** Sessão de suporte da plataforma (somente leitura, temporária, auditada) */
  support: boolean;
  readOnly: boolean;
}

export interface BuildCtxOptions {
  correlationId?: string;
  support?: boolean;
}

/**
 * Monta o contexto de execução a partir de usuário + organização.
 * Usado pela aplicação web (sessão), pelos testes e pelas tarefas em segundo plano.
 */
export async function buildCtx(userId: string, orgId: string, opts: BuildCtxOptions = {}): Promise<Ctx> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) throw new AppError("UNAUTHENTICATED", "Usuário inválido.");
  const org = await prisma.organization.findUnique({ where: { id: orgId }, include: { plan: true } });
  if (!org) throw new AppError("NOT_FOUND", "Organização não encontrada.");

  let membership = await prisma.membership.findUnique({ where: { userId_organizationId: { userId, organizationId: orgId } } });
  let permissions = new Set<string>();
  let roleKeys: string[] = [];
  if (opts.support) {
    if (!user.isPlatformAdmin) throw forbidden();
    const grant = await prisma.supportAccessGrant.findFirst({
      where: { organizationId: orgId, platformUserId: userId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!grant) throw forbidden("Acesso de suporte não autorizado ou expirado.");
    // Suporte: somente leitura operacional, sem custos/margens.
    permissions = new Set(["master.read", "crm.read", "contract.read", "project.read", "resource.read", "ams.read", "billing.read", "finance.read", "audit.view"]);
    roleKeys = ["support"];
    membership = membership ?? null;
  } else {
    if (!membership || !membership.active) throw forbidden("Você não pertence a esta organização.");
    const roles = await prisma.role.findMany({ where: { organizationId: orgId, id: { in: membership.roleIds } } });
    // Usuário de portal (cliente) recebe apenas permissões do portal, mesmo que um perfil interno lhe seja atribuído por engano.
    for (const r of roles) for (const p of r.permissions) if (membership.kind !== "CLIENT" || p.startsWith("portal.")) permissions.add(p);
    roleKeys = roles.map((r) => r.key);
  }

  const companyIds = opts.support || !membership || membership.allCompanies ? null : membership.companyIds;
  // Módulos efetivos = contratados no plano ∩ habilitados pela organização
  const modSetting = await prisma.orgSetting.findUnique({ where: { organizationId_key: { organizationId: orgId, key: "modules" } } });
  const enabled = (modSetting?.value as { enabled?: string[] } | null)?.enabled;
  const planModules = enabled ? org.plan.modules.filter((m) => enabled.includes(m) || m === "api") : org.plan.modules;
  // Organização suspensa/cancelada: dados preservados, acesso somente leitura
  const readOnly = !!opts.support || org.status === "SUSPENDED" || org.status === "CANCELED";

  return {
    userId,
    userName: user.name,
    userEmail: user.email,
    orgId,
    orgName: org.name,
    orgStatus: org.status,
    sector: org.sector,
    timezone: org.timezone,
    currency: org.currency,
    planModules,
    membershipId: membership?.id ?? "support",
    kind: (membership?.kind as "INTERNAL" | "CLIENT") ?? "INTERNAL",
    permissions,
    roleKeys,
    companyIds,
    partyId: membership?.partyId ?? null,
    professionalId: membership?.professionalId ?? null,
    db: createTenantDb({ orgId, companyIds }),
    correlationId: opts.correlationId ?? randomUUID(),
    support: !!opts.support,
    readOnly,
  };
}

export const SYSTEM_USER_ID = "system";

/**
 * Contexto de tarefas agendadas (sem usuário humano): escopo da organização inteira, apenas as permissões informadas,
 * auditoria registrada como "Sistema (tarefa agendada)".
 */
export async function systemCtx(orgId: string, permissions: Permission[]): Promise<Ctx> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, include: { plan: true } });
  if (!org) throw new AppError("NOT_FOUND", "Organização não encontrada.");
  const modSetting = await prisma.orgSetting.findUnique({ where: { organizationId_key: { organizationId: orgId, key: "modules" } } });
  const enabled = (modSetting?.value as { enabled?: string[] } | null)?.enabled;
  return {
    userId: SYSTEM_USER_ID, userName: "Sistema (tarefa agendada)", userEmail: "", orgId, orgName: org.name, orgStatus: org.status, sector: org.sector, timezone: org.timezone, currency: org.currency,
    planModules: enabled ? org.plan.modules.filter((m) => enabled.includes(m) || m === "api") : org.plan.modules,
    membershipId: "system", kind: "INTERNAL", permissions: new Set(permissions), roleKeys: ["system"], companyIds: null, partyId: null, professionalId: null,
    db: createTenantDb({ orgId, companyIds: null }), correlationId: randomUUID(), support: false, readOnly: org.status === "SUSPENDED" || org.status === "CANCELED",
  };
}

export function can(ctx: Ctx, perm: Permission): boolean {
  return ctx.permissions.has(perm);
}

export function requirePerm(ctx: Ctx, ...perms: Permission[]) {
  for (const p of perms) if (!ctx.permissions.has(p)) throw forbidden(`Permissão necessária: ${p}.`);
}

export function requireAnyPerm(ctx: Ctx, ...perms: Permission[]) {
  if (!perms.some((p) => ctx.permissions.has(p))) throw forbidden(`Permissão necessária: ${perms.join(" ou ")}.`);
}

/** Bloqueia escrita em organizações suspensas/canceladas ou sessões de suporte. */
export function requireWritable(ctx: Ctx) {
  if (ctx.readOnly) {
    throw new AppError("FORBIDDEN", ctx.support ? "Sessão de suporte é somente leitura." : "Organização suspensa ou cancelada: acesso somente leitura. Regularize a assinatura.");
  }
}

export function requireModule(ctx: Ctx, module: string) {
  if (!ctx.planModules.includes(module)) {
    throw new AppError("PLAN_LIMIT", `O módulo "${module}" não está incluído no plano atual. Faça upgrade para utilizá-lo.`);
  }
}

export function inCompanyScope(ctx: Ctx, companyId: string) {
  return ctx.companyIds === null || ctx.companyIds.includes(companyId);
}

export function requireInternal(ctx: Ctx) {
  if (ctx.kind !== "INTERNAL") throw forbidden("Área restrita a usuários internos.");
}
