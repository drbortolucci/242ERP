import { prisma } from "@/server/db";
import { AppError } from "@/lib/errors";

/** Limites do plano aplicados no servidor. */
export async function getUsage(orgId: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, include: { plan: true } });
  const [users, companies, pendingInvites] = await Promise.all([
    prisma.membership.count({ where: { organizationId: orgId, active: true, kind: "INTERNAL" } }),
    prisma.company.count({ where: { organizationId: orgId, active: true } }),
    prisma.invitation.count({ where: { organizationId: orgId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() }, kind: "INTERNAL" } }),
  ]);
  return {
    plan: org.plan,
    users,
    pendingInvites,
    companies,
    storageBytes: Number(org.storageUsedBytes),
    limits: { users: org.plan.maxUsers, companies: org.plan.maxCompanies, storageBytes: org.plan.maxStorageMb * 1024 * 1024 },
  };
}

export async function assertUserLimit(orgId: string, adding = 1) {
  const u = await getUsage(orgId);
  if (u.users + u.pendingInvites + adding > u.limits.users) {
    throw new AppError("PLAN_LIMIT", `Limite de usuários do plano ${u.plan.name} atingido (${u.limits.users}). Faça upgrade ou desative usuários.`);
  }
}

export async function assertCompanyLimit(orgId: string, adding = 1) {
  const u = await getUsage(orgId);
  if (u.companies + adding > u.limits.companies) {
    throw new AppError("PLAN_LIMIT", `Limite de empresas do plano ${u.plan.name} atingido (${u.limits.companies}). Faça upgrade para cadastrar mais empresas.`);
  }
}

export async function assertStorageLimit(orgId: string, addingBytes: number) {
  const u = await getUsage(orgId);
  if (u.storageBytes + addingBytes > u.limits.storageBytes) {
    throw new AppError("PLAN_LIMIT", `Limite de armazenamento do plano atingido (${u.plan.maxStorageMb} MB).`);
  }
}

/** Regras de downgrade: o uso atual precisa caber no plano de destino. */
export async function downgradeBlockers(orgId: string, targetPlanId: string): Promise<string[]> {
  const target = await prisma.plan.findUniqueOrThrow({ where: { id: targetPlanId } });
  const u = await getUsage(orgId);
  const out: string[] = [];
  if (u.users > target.maxUsers) out.push(`Usuários ativos (${u.users}) acima do limite do plano ${target.name} (${target.maxUsers}).`);
  if (u.companies > target.maxCompanies) out.push(`Empresas ativas (${u.companies}) acima do limite (${target.maxCompanies}).`);
  if (u.storageBytes > target.maxStorageMb * 1024 * 1024) out.push(`Armazenamento utilizado acima do limite (${target.maxStorageMb} MB).`);
  return out;
}
