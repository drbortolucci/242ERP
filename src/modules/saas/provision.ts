import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { hashPassword, validatePasswordStrength } from "@/server/auth/crypto";
import { validation, conflict } from "@/lib/errors";
import {
  DEFAULT_ACCOUNTS, DEFAULT_APPROVAL_RULES, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_LOSS_REASONS, DEFAULT_PAYMENT_METHODS,
  DEFAULT_PAYMENT_TERMS, DEFAULT_PIPELINE, DEFAULT_PROJECT_TYPES, DEFAULT_SENIORITY, DEFAULT_SERVICES, DEFAULT_SLA,
  DEFAULT_TEAM_ROLES, ROLE_TEMPLATES,
} from "../admin/defaults";
import { auditPlatform } from "@/server/audit";

type Tx = Prisma.TransactionClient;

export function slugify(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "org";
}

/** Cria configuração padrão da organização (perfis, plano de contas, funil, SLA, etc.). */
export async function seedOrgDefaults(tx: Tx, orgId: string) {
  const roles = [];
  for (const t of ROLE_TEMPLATES) {
    roles.push(await tx.role.create({ data: { organizationId: orgId, key: t.key, name: t.name, description: t.description, permissions: t.permissions, isSystem: true } }));
  }
  const accountIds = new Map<string, string>();
  for (const a of DEFAULT_ACCOUNTS) {
    const created = await tx.managerialAccount.create({
      data: { organizationId: orgId, code: a.code, name: a.name, type: a.type, systemKey: a.systemKey ?? null, parentId: a.parent ? accountIds.get(a.parent) : null },
    });
    accountIds.set(a.code, created.id);
  }
  const bySystemKey = async (k: string) => (await tx.managerialAccount.findFirst({ where: { organizationId: orgId, systemKey: k } }))?.id ?? null;

  await tx.pipelineStage.createMany({ data: DEFAULT_PIPELINE.map((s, i) => ({ organizationId: orgId, name: s.name, order: i + 1, probability: s.probability, kind: s.kind })) });
  await tx.lossReason.createMany({ data: DEFAULT_LOSS_REASONS.map((name) => ({ organizationId: orgId, name })) });
  await tx.projectType.createMany({ data: DEFAULT_PROJECT_TYPES.map((p) => ({ organizationId: orgId, ...p })) });
  await tx.teamRole.createMany({ data: DEFAULT_TEAM_ROLES.map((name) => ({ organizationId: orgId, name })) });
  await tx.seniorityLevel.createMany({ data: DEFAULT_SENIORITY.map((name, i) => ({ organizationId: orgId, name, order: i + 1 })) });
  const directExp = await bySystemKey("DIRECT_EXPENSES");
  await tx.expenseCategory.createMany({ data: DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ organizationId: orgId, accountId: directExp, ...c })) });
  await tx.paymentTerm.createMany({ data: DEFAULT_PAYMENT_TERMS.map((t) => ({ organizationId: orgId, name: t.name, installments: t.installments })) });
  await tx.paymentMethod.createMany({ data: DEFAULT_PAYMENT_METHODS.map((name) => ({ organizationId: orgId, name })) });
  await tx.approvalRule.createMany({
    data: DEFAULT_APPROVAL_RULES.map((r) => ({
      organizationId: orgId, docType: r.docType, name: r.name, requiredPermission: r.requiredPermission,
      minAmount: "minAmount" in r ? r.minAmount : null, maxDiscountPct: "maxDiscountPct" in r ? r.maxDiscountPct : null, minMarginPct: "minMarginPct" in r ? r.minMarginPct : null,
    })),
  });
  const cal = await tx.workCalendar.create({ data: { organizationId: orgId, name: "Padrão 8h seg-sex", weeklyHours: [0, 8, 8, 8, 8, 8, 0] } });
  const sla = await tx.slaPolicy.create({ data: { organizationId: orgId, name: DEFAULT_SLA.name, calendarId: cal.id, pauseStatuses: DEFAULT_SLA.pauseStatuses } });
  await tx.slaTarget.createMany({ data: DEFAULT_SLA.targets.map((t) => ({ organizationId: orgId, policyId: sla.id, ...t })) });
  for (const s of DEFAULT_SERVICES) {
    await tx.service.create({ data: { organizationId: orgId, code: s.code, name: s.name, category: s.category, defaultModel: s.defaultModel, revenueAccountId: await bySystemKey(s.account) } });
  }
  await tx.onboardingState.create({ data: { organizationId: orgId, step: 1 } });
  return { roles, calendarId: cal.id };
}

export interface SignupInput {
  orgName: string;
  userName: string;
  email: string;
  password: string;
  planCode: string;
}

export async function provisionOrganization(input: SignupInput) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw validation("E-mail inválido.");
  const pwErr = validatePasswordStrength(input.password);
  if (pwErr) throw validation(pwErr);
  if (input.orgName.trim().length < 2) throw validation("Informe o nome da organização.");
  const plan = await prisma.plan.findUnique({ where: { code: input.planCode } });
  if (!plan || !plan.active) throw validation("Plano inválido.");
  if (await prisma.user.findUnique({ where: { email } })) throw conflict("Já existe uma conta com este e-mail. Entre e crie a organização a partir do seu perfil.");

  const passwordHash = await hashPassword(input.password);
  const baseSlug = slugify(input.orgName);
  let slug = baseSlug;
  for (let i = 2; await prisma.organization.findUnique({ where: { slug } }); i++) slug = `${baseSlug}-${i}`;

  const result = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + plan.trialDays * 86400000);
    const user = await tx.user.create({ data: { email, name: input.userName.trim(), passwordHash } });
    const org = await tx.organization.create({ data: { name: input.orgName.trim(), slug, planId: plan.id, status: "TRIAL", trialEndsAt } });
    await tx.subscription.create({ data: { organizationId: org.id, planId: plan.id, status: "TRIALING", currentPeriodStart: now, currentPeriodEnd: trialEndsAt } });
    await tx.planChange.create({ data: { organizationId: org.id, toPlanId: plan.id, kind: "INITIAL", effectiveAt: now, requestedById: user.id } });
    const { roles } = await seedOrgDefaults(tx, org.id);
    const admin = roles.find((r) => r.key === "org_admin")!;
    await tx.membership.create({ data: { userId: user.id, organizationId: org.id, roleIds: [admin.id], allCompanies: true } });
    return { user, org };
  }, { timeout: 30000 });
  await auditPlatform(result.user.id, "org.create", "Organization", result.org.id, { plan: plan.code }, result.org.id);
  return result;
}
