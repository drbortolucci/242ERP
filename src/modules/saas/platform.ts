import { prisma } from "@/server/db";
import { auditPlatform } from "@/server/audit";
import { forbidden, validation } from "@/lib/errors";
import { dec, sum } from "@/lib/money";

async function requireAdmin(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u?.isPlatformAdmin) throw forbidden();
}

/** Métricas da plataforma — somente dados de assinatura e uso agregado, nunca dados empresariais. */
export async function platformMetrics(userId: string) {
  await requireAdmin(userId);
  const now = new Date();
  const [byStatus, activeSubs, trialsEnding, newOrgs, failedJobs, webhookErrors, invoices] = await Promise.all([
    prisma.organization.groupBy({ by: ["status"], _count: true }),
    prisma.subscription.findMany({ where: { status: "ACTIVE" }, include: { plan: true } }),
    prisma.organization.count({ where: { status: "TRIAL", trialEndsAt: { lt: new Date(now.getTime() + 7 * 86400000) } } }),
    prisma.organization.count({ where: { createdAt: { gt: new Date(now.getTime() - 30 * 86400000) } } }),
    prisma.job.count({ where: { status: "FAILED" } }),
    prisma.webhookEvent.count({ where: { error: { not: null } } }),
    prisma.saasInvoice.findMany({ where: { status: "PAID", paidAt: { gt: new Date(now.getTime() - 30 * 86400000) } } }),
  ]);
  return {
    byStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count])),
    mrr: sum(activeSubs.map((s) => s.plan.priceMonthly)),
    activeSubs: activeSubs.length,
    trialsEnding, newOrgs, failedJobs, webhookErrors,
    revenue30d: sum(invoices.map((i) => i.amount)),
  };
}

export async function listOrganizations(userId: string) {
  await requireAdmin(userId);
  const orgs = await prisma.organization.findMany({ include: { plan: true, subscription: true }, orderBy: { createdAt: "desc" } });
  const users = await prisma.membership.groupBy({ by: ["organizationId"], where: { active: true, kind: "INTERNAL" }, _count: true });
  const companies = await prisma.company.groupBy({ by: ["organizationId"], where: { active: true }, _count: true });
  const um = new Map(users.map((u) => [u.organizationId, u._count]));
  const cm = new Map(companies.map((u) => [u.organizationId, u._count]));
  return orgs.map((o) => ({ ...o, users: um.get(o.id) ?? 0, companies: cm.get(o.id) ?? 0 }));
}

export async function setOrgStatusManually(userId: string, orgId: string, status: "ACTIVE" | "SUSPENDED", reason: string) {
  await requireAdmin(userId);
  if (!reason.trim()) throw validation("Informe o motivo.");
  await prisma.$transaction([
    prisma.organization.update({ where: { id: orgId }, data: { status, suspendedAt: status === "SUSPENDED" ? new Date() : null } }),
    prisma.subscription.updateMany({ where: { organizationId: orgId }, data: { status: status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE" } }),
  ]);
  await auditPlatform(userId, `platform.org_${status.toLowerCase()}`, "Organization", orgId, { reason }, orgId);
}

export async function updatePlan(userId: string, planId: string, i: { name: string; priceMonthly: string; maxUsers: number; maxCompanies: number; maxStorageMb: number; trialDays: number; modules: string[]; active: boolean }) {
  await requireAdmin(userId);
  if (dec(i.priceMonthly).lt(0)) throw validation("Preço inválido.");
  const before = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
  await prisma.plan.update({ where: { id: planId }, data: { ...i, priceMonthly: i.priceMonthly } });
  await auditPlatform(userId, "platform.plan_update", "Plan", planId, { before: { price: before.priceMonthly.toString(), maxUsers: before.maxUsers, modules: before.modules }, after: i });
}

export async function grantsForPlatformUser(userId: string) {
  await requireAdmin(userId);
  const grants = await prisma.supportAccessGrant.findMany({ where: { platformUserId: userId, revokedAt: null, expiresAt: { gt: new Date() } } });
  const orgs = await prisma.organization.findMany({ where: { id: { in: grants.map((g) => g.organizationId) } } });
  return grants.map((g) => ({ ...g, orgName: orgs.find((o) => o.id === g.organizationId)?.name ?? "?" }));
}
