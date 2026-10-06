import { prisma } from "@/server/db";
import { requirePerm, type Ctx } from "@/server/context";
import { audit, auditPlatform } from "@/server/audit";
import { paymentProvider } from "@/server/providers/payments";
import { AppError, notFound, rule, validation } from "@/lib/errors";
import { downgradeBlockers } from "./limits";
import { SETTING_DEFAULTS } from "@/server/settings";
import { logger } from "@/server/logger";

const DAY = 86400000;

export async function getSubscription(orgId: string) {
  const sub = await prisma.subscription.findUnique({ where: { organizationId: orgId }, include: { plan: true, invoices: { orderBy: { createdAt: "desc" }, take: 24 } } });
  const changes = await prisma.planChange.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" } });
  const plans = await prisma.plan.findMany({ where: { active: true }, orderBy: { rank: "asc" } });
  return { sub, changes, plans };
}

/** Ativa a assinatura paga (fim do trial) via provedor. */
export async function activateSubscription(ctx: Ctx) {
  requirePerm(ctx, "org.manage");
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: ctx.orgId }, include: { plan: true } });
  if (sub.status === "ACTIVE") throw rule("Assinatura já está ativa.");
  const res = await paymentProvider().subscribe({ organizationId: ctx.orgId, planCode: sub.plan.code, amount: sub.plan.priceMonthly.toFixed(2), email: ctx.userEmail });
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({ where: { id: sub.id }, data: { status: res.status === "ACTIVE" ? "ACTIVE" : "PAST_DUE", provider: paymentProvider().name, providerCustomerId: res.providerCustomerId, providerSubscriptionId: res.providerSubscriptionId, currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * DAY), pastDueSince: null, cancelAtPeriodEnd: false } });
    if (res.invoice) await tx.saasInvoice.create({ data: { subscriptionId: sub.id, organizationId: ctx.orgId, providerInvoiceId: res.invoice.id, amount: res.invoice.amount, periodStart: now, periodEnd: new Date(now.getTime() + 30 * DAY), status: res.invoice.paid ? "PAID" : "OPEN", paidAt: res.invoice.paid ? now : null } });
    await tx.organization.update({ where: { id: ctx.orgId }, data: { status: res.status === "ACTIVE" ? "ACTIVE" : "PAST_DUE", suspendedAt: null } });
  });
  await audit(ctx, { action: "subscription.activate", entity: "Subscription", entityId: sub.id, changes: { provider: paymentProvider().name } });
}

/**
 * Upgrade: efeito imediato. Downgrade: exige que o uso caiba no plano de destino e vale a partir do próximo ciclo.
 */
export async function changePlan(ctx: Ctx, targetPlanId: string) {
  requirePerm(ctx, "org.manage");
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, include: { plan: true } });
  const target = await prisma.plan.findUnique({ where: { id: targetPlanId } });
  if (!target || !target.active) throw validation("Plano inválido.");
  if (target.id === org.planId) throw rule("Este já é o plano atual.");
  const isUpgrade = target.rank > org.plan.rank;
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: ctx.orgId } });
  if (isUpgrade) {
    await prisma.$transaction([
      prisma.organization.update({ where: { id: ctx.orgId }, data: { planId: target.id } }),
      prisma.subscription.update({ where: { id: sub.id }, data: { planId: target.id, pendingPlanId: null } }),
      prisma.planChange.create({ data: { organizationId: ctx.orgId, fromPlanId: org.planId, toPlanId: target.id, kind: "UPGRADE", effectiveAt: new Date(), requestedById: ctx.userId } }),
    ]);
  } else {
    const blockers = await downgradeBlockers(ctx.orgId, target.id);
    if (blockers.length) throw new AppError("PLAN_LIMIT", `Downgrade bloqueado: ${blockers.join(" ")}`);
    const effectiveAt = sub.status === "TRIALING" ? new Date() : sub.currentPeriodEnd ?? new Date();
    if (sub.status === "TRIALING") {
      await prisma.$transaction([
        prisma.organization.update({ where: { id: ctx.orgId }, data: { planId: target.id } }),
        prisma.subscription.update({ where: { id: sub.id }, data: { planId: target.id } }),
      ]);
    } else {
      await prisma.subscription.update({ where: { id: sub.id }, data: { pendingPlanId: target.id } });
    }
    await prisma.planChange.create({ data: { organizationId: ctx.orgId, fromPlanId: org.planId, toPlanId: target.id, kind: "DOWNGRADE", effectiveAt, requestedById: ctx.userId } });
  }
  await audit(ctx, { action: isUpgrade ? "subscription.upgrade" : "subscription.downgrade", entity: "Subscription", entityId: sub.id, changes: { from: org.plan.code, to: target.code } });
  return { isUpgrade };
}

export async function cancelSubscription(ctx: Ctx, reason: string) {
  requirePerm(ctx, "org.manage");
  if (!reason.trim()) throw validation("Informe o motivo do cancelamento.");
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: ctx.orgId } });
  if (sub.status === "CANCELED") throw rule("Assinatura já cancelada.");
  if (sub.status === "TRIALING") {
    await finalizeCancellation(ctx.orgId, ctx.userId, reason);
  } else {
    await prisma.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true } });
    if (sub.providerSubscriptionId) await paymentProvider().cancel(sub.providerSubscriptionId);
    await prisma.planChange.create({ data: { organizationId: ctx.orgId, fromPlanId: sub.planId, toPlanId: sub.planId, kind: "CANCEL", effectiveAt: sub.currentPeriodEnd ?? new Date(), requestedById: ctx.userId, reason } });
  }
  await audit(ctx, { action: "subscription.cancel", entity: "Subscription", entityId: sub.id, reason });
}

async function finalizeCancellation(orgId: string, userId: string | null, reason?: string) {
  const retentionDays = SETTING_DEFAULTS.suspension.retentionDaysAfterCancel;
  const now = new Date();
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });
  await prisma.$transaction([
    prisma.subscription.update({ where: { id: sub.id }, data: { status: "CANCELED", cancelAtPeriodEnd: false } }),
    prisma.organization.update({ where: { id: orgId }, data: { status: "CANCELED", canceledAt: now, retentionUntil: new Date(now.getTime() + retentionDays * DAY) } }),
    prisma.planChange.create({ data: { organizationId: orgId, fromPlanId: sub.planId, toPlanId: sub.planId, kind: "CANCEL", effectiveAt: now, requestedById: userId, reason: reason ?? "Fim do período" } }),
  ]);
}

export async function reactivate(ctx: Ctx) {
  requirePerm(ctx, "org.manage");
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: ctx.orgId }, include: { plan: true } });
  if (sub.cancelAtPeriodEnd && sub.status !== "CANCELED") {
    await prisma.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: false } });
  } else if (org.status === "CANCELED" || org.status === "SUSPENDED") {
    if (org.status === "CANCELED" && org.retentionUntil && org.retentionUntil < new Date()) throw rule("Prazo de retenção encerrado. Contate o suporte da plataforma.");
    const res = await paymentProvider().subscribe({ organizationId: ctx.orgId, planCode: sub.plan.code, amount: sub.plan.priceMonthly.toFixed(2), email: ctx.userEmail });
    const now = new Date();
    await prisma.$transaction([
      prisma.subscription.update({ where: { id: sub.id }, data: { status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * DAY), pastDueSince: null, providerSubscriptionId: res.providerSubscriptionId } }),
      prisma.organization.update({ where: { id: ctx.orgId }, data: { status: "ACTIVE", canceledAt: null, retentionUntil: null, suspendedAt: null } }),
      prisma.planChange.create({ data: { organizationId: ctx.orgId, fromPlanId: sub.planId, toPlanId: sub.planId, kind: "REACTIVATE", effectiveAt: now, requestedById: ctx.userId } }),
    ]);
  } else throw rule("Nada a reativar.");
  await audit(ctx, { action: "subscription.reactivate", entity: "Subscription", entityId: sub.id });
}

/**
 * Webhook do provedor (já autenticado). Idempotente por (provider, eventId).
 * Eventos: invoice.paid | invoice.payment_failed | subscription.canceled
 */
export async function handlePaymentWebhook(provider: string, event: { id: string; type: string; data: { organizationId?: string; providerSubscriptionId?: string; invoiceId?: string; amount?: string; reason?: string } }) {
  try {
    await prisma.webhookEvent.create({ data: { provider, eventId: event.id, type: event.type, payload: event as object } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { duplicate: true };
    throw e;
  }
  const sub = event.data.providerSubscriptionId
    ? await prisma.subscription.findFirst({ where: { providerSubscriptionId: event.data.providerSubscriptionId } })
    : event.data.organizationId ? await prisma.subscription.findUnique({ where: { organizationId: event.data.organizationId } }) : null;
  if (!sub) {
    await prisma.webhookEvent.update({ where: { provider_eventId: { provider, eventId: event.id } }, data: { error: "Assinatura não encontrada", processedAt: new Date() } });
    throw notFound("Assinatura");
  }
  const now = new Date();
  if (event.type === "invoice.paid") {
    const start = sub.currentPeriodEnd && sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now;
    await prisma.$transaction(async (tx) => {
      if (event.data.invoiceId) {
        await tx.saasInvoice.upsert({ where: { providerInvoiceId: event.data.invoiceId }, create: { subscriptionId: sub.id, organizationId: sub.organizationId, providerInvoiceId: event.data.invoiceId, amount: event.data.amount ?? "0", periodStart: start, periodEnd: new Date(start.getTime() + 30 * DAY), status: "PAID", paidAt: now }, update: { status: "PAID", paidAt: now } });
      }
      const planId = sub.pendingPlanId ?? sub.planId;
      await tx.subscription.update({ where: { id: sub.id }, data: { status: "ACTIVE", pastDueSince: null, currentPeriodStart: start, currentPeriodEnd: new Date(start.getTime() + 30 * DAY), planId, pendingPlanId: null } });
      await tx.organization.update({ where: { id: sub.organizationId }, data: { status: "ACTIVE", suspendedAt: null, planId } });
    });
  } else if (event.type === "invoice.payment_failed") {
    await prisma.$transaction(async (tx) => {
      if (event.data.invoiceId) await tx.saasInvoice.upsert({ where: { providerInvoiceId: event.data.invoiceId }, create: { subscriptionId: sub.id, organizationId: sub.organizationId, providerInvoiceId: event.data.invoiceId, amount: event.data.amount ?? "0", periodStart: now, periodEnd: new Date(now.getTime() + 30 * DAY), status: "FAILED", failureReason: event.data.reason ?? null }, update: { status: "FAILED", failureReason: event.data.reason ?? null } });
      await tx.subscription.update({ where: { id: sub.id }, data: { status: "PAST_DUE", pastDueSince: sub.pastDueSince ?? now } });
      await tx.organization.update({ where: { id: sub.organizationId }, data: { status: "PAST_DUE" } });
    });
  } else if (event.type === "subscription.canceled") {
    await finalizeCancellation(sub.organizationId, null, event.data.reason ?? "Cancelada no provedor");
  }
  await prisma.webhookEvent.update({ where: { provider_eventId: { provider, eventId: event.id } }, data: { processedAt: new Date() } });
  await auditPlatform(null, `webhook.${event.type}`, "Subscription", sub.id, { eventId: event.id }, sub.organizationId);
  return { duplicate: false };
}

/**
 * Política diária: trial vencido → inadimplente; inadimplente além da carência → suspensa (somente leitura);
 * cancelamento agendado no fim do período → cancelada com retenção. Nunca exclui dados.
 */
export async function runBillingPolicy(now = new Date()) {
  const grace = SETTING_DEFAULTS.suspension.graceDays;
  let changed = 0;
  const trials = await prisma.subscription.findMany({ where: { status: "TRIALING", currentPeriodEnd: { lt: now } } });
  for (const s of trials) {
    await prisma.$transaction([
      prisma.subscription.update({ where: { id: s.id }, data: { status: "PAST_DUE", pastDueSince: now } }),
      prisma.organization.update({ where: { id: s.organizationId }, data: { status: "PAST_DUE" } }),
    ]);
    changed++;
  }
  const overdue = await prisma.subscription.findMany({ where: { status: "PAST_DUE", pastDueSince: { lt: new Date(now.getTime() - grace * DAY) } } });
  for (const s of overdue) {
    await prisma.$transaction([
      prisma.subscription.update({ where: { id: s.id }, data: { status: "SUSPENDED" } }),
      prisma.organization.update({ where: { id: s.organizationId }, data: { status: "SUSPENDED", suspendedAt: now } }),
    ]);
    await auditPlatform(null, "org.suspended_by_policy", "Organization", s.organizationId, { graceDays: grace }, s.organizationId);
    changed++;
  }
  const ending = await prisma.subscription.findMany({ where: { cancelAtPeriodEnd: true, currentPeriodEnd: { lt: now }, status: { not: "CANCELED" } } });
  for (const s of ending) {
    await finalizeCancellation(s.organizationId, null);
    changed++;
  }
  // Downgrades agendados sem evento de pagamento (provedor simulado): aplica no fim do ciclo
  const pendingDowngrades = await prisma.subscription.findMany({ where: { pendingPlanId: { not: null }, currentPeriodEnd: { lt: now } } });
  for (const s of pendingDowngrades) {
    await prisma.$transaction([
      prisma.subscription.update({ where: { id: s.id }, data: { planId: s.pendingPlanId!, pendingPlanId: null } }),
      prisma.organization.update({ where: { id: s.organizationId }, data: { planId: s.pendingPlanId! } }),
    ]);
    changed++;
  }
  logger.info("saas.billing_policy", { changed });
  return { changed };
}
