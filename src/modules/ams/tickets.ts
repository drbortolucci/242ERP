/**
 * Chamados AMS: abertura (matriz impacto × urgência → prioridade → prazos de SLA em minutos úteis), atendimento,
 * pausas (aguardando cliente/terceiro), resolução, encerramento/reabertura, escalonamento, problemas e satisfação.
 * Usuários do portal (cliente) só enxergam chamados da própria parte e apenas comentários públicos.
 */
import { z } from "zod";
import { prisma } from "@/server/db";
import { requirePerm, requireWritable, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { nextNumber } from "@/server/sequences";
import { notify, usersWithPermission } from "@/server/notify";
import { forbidden, notFound, rule, validation } from "@/lib/errors";
import { zOptId, zOptStr, zStr } from "@/lib/zod-helpers";
import { addBusinessMinutes, businessMinutesBetween, priorityFrom, slaConsumedPct } from "@/domain/sla";
import { dueDates, loadSla } from "./sla";
import type { Ticket } from "@prisma/client";
import type { TenantTx } from "@/server/tenant-db";

export const TICKET_TYPES = ["INCIDENT", "REQUEST", "PROBLEM", "CHANGE"] as const;
export const OPEN_STATUSES = ["NEW", "IN_PROGRESS", "WAITING_CUSTOMER", "WAITING_THIRD_PARTY"];
const TRANSITIONS: Record<string, string[]> = {
  NEW: ["IN_PROGRESS", "WAITING_CUSTOMER", "WAITING_THIRD_PARTY", "RESOLVED", "CANCELED"],
  IN_PROGRESS: ["WAITING_CUSTOMER", "WAITING_THIRD_PARTY", "RESOLVED", "CANCELED"],
  WAITING_CUSTOMER: ["IN_PROGRESS", "RESOLVED", "CANCELED"],
  WAITING_THIRD_PARTY: ["IN_PROGRESS", "RESOLVED", "CANCELED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: ["IN_PROGRESS"],
  CANCELED: [],
};

const isClient = (ctx: Ctx) => ctx.kind === "CLIENT";
function canRead(ctx: Ctx) {
  if (isClient(ctx)) requirePerm(ctx, "portal.access");
  else requirePerm(ctx, "ams.read");
}

export async function getTicket(ctx: Ctx, id: string) {
  canRead(ctx);
  const t = await ctx.db.ticket.findFirst({ where: { id, ...(isClient(ctx) ? { partyId: ctx.partyId ?? "__none__" } : {}) } });
  if (!t) throw notFound("Chamado");
  return t;
}

async function event(ctx: Ctx, tx: TenantTx, ticketId: string, kind: string, fromValue: string | null, toValue: string | null) {
  await tx.ticketEvent.create({ data: { organizationId: ctx.orgId, ticketId, kind, fromValue, toValue, byUserId: ctx.userId } });
}

// ------------------------------------------------------------------ Abertura
export const ticketSchema = z.object({
  companyId: zOptId, partyId: zOptId, contractId: zOptId, serviceId: zOptId, type: z.enum(TICKET_TYPES).default("INCIDENT"),
  system: zOptStr, module: zOptStr, category: zOptStr, title: zStr(3), description: zStr(3),
  impact: z.coerce.number().int().min(1).max(3).default(3), urgency: z.coerce.number().int().min(1).max(3).default(3),
  openedByContactName: zOptStr, assigneeProfessionalId: zOptId, team: zOptStr,
});
export type TicketInput = z.infer<typeof ticketSchema>;

export async function openTicket(ctx: Ctx, i: TicketInput, now = new Date()) {
  if (isClient(ctx)) requirePerm(ctx, "portal.access");
  else requirePerm(ctx, "ams.write");
  requireWritable(ctx);
  const partyId = isClient(ctx) ? ctx.partyId : i.partyId;
  if (!partyId) throw validation("Informe o cliente.");
  const party = await ctx.db.party.findFirst({ where: { id: partyId } });
  if (!party) throw validation("Cliente inválido.");
  let contract = i.contractId ? await ctx.db.contract.findFirst({ where: { id: i.contractId } }) : null;
  if (i.contractId && (!contract || contract.partyId !== partyId)) throw validation("Contrato não pertence ao cliente.");
  if (!contract) contract = await ctx.db.contract.findFirst({ where: { partyId, commercialModel: "AMS_RECURRING", status: "ACTIVE" }, orderBy: { startDate: "desc" } });
  if (contract && contract.status !== "ACTIVE") throw rule("Contrato não está ativo para atendimento.");
  const companyId = contract?.companyId ?? i.companyId;
  if (!companyId) throw validation("Informe a empresa de atendimento (cliente sem contrato AMS ativo).");
  if (isClient(ctx) && (i.assigneeProfessionalId || i.team)) throw forbidden("O cliente não define o responsável.");
  const priority = priorityFrom(i.impact, i.urgency);
  const sla = await loadSla(ctx.orgId, contract?.slaPolicyId, ctx.timezone);
  const due = dueDates(sla, priority, now);
  const t = await ctx.db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "TICKET");
    const t = await tx.ticket.create({
      data: {
        organizationId: ctx.orgId, companyId, number, partyId, contractId: contract?.id ?? null, serviceId: i.serviceId ?? null, type: i.type, system: i.system ?? null, module: i.module ?? null, category: i.category ?? null,
        title: i.title, description: i.description, impact: i.impact, urgency: i.urgency, priority, assigneeProfessionalId: i.assigneeProfessionalId ?? null, team: i.team ?? null,
        openedByUserId: ctx.userId, openedByContactName: i.openedByContactName ?? (isClient(ctx) ? ctx.userName : null), openedAt: now, slaPolicyId: sla.policy?.id ?? null, ...due,
      },
    });
    await event(ctx, tx, t.id, "STATUS", null, "NEW");
    await audit(ctx, { action: "ticket.open", entity: "Ticket", entityId: t.id, companyId, changes: { priority, contract: contract?.number ?? null } }, tx);
    return t;
  });
  const managers = await usersWithPermission(ctx.orgId, "ams.manage");
  if (priority === "P1" || priority === "P2" || isClient(ctx)) await notify(ctx.orgId, managers, { title: `Chamado ${t.number} (${priority}) aberto`, body: t.title, link: `/app/ams/chamados/${t.id}` });
  return t;
}

// ------------------------------------------------------------------ Situação, pausa, resolução, reabertura
export async function changeStatus(ctx: Ctx, id: string, to: string, note?: string, now = new Date()) {
  requireWritable(ctx);
  const t = await getTicket(ctx, id);
  if (isClient(ctx)) {
    // cliente: confirma solução (encerra), reabre, ou responde quando aguardando cliente
    const allowed = (t.status === "RESOLVED" && ["CLOSED", "IN_PROGRESS"].includes(to)) || (t.status === "CLOSED" && to === "IN_PROGRESS") || (t.status === "WAITING_CUSTOMER" && to === "IN_PROGRESS");
    if (!allowed) throw forbidden("Ação não permitida no portal.");
  } else requirePerm(ctx, "ams.write");
  if (!(TRANSITIONS[t.status] ?? []).includes(to)) throw rule(`Transição inválida: ${t.status} → ${to}.`);
  if (to === "CANCELED" && !note?.trim()) throw validation("Informe o motivo do cancelamento.");
  const sla = await loadSla(ctx.orgId, t.slaPolicyId, ctx.timezone);
  const pauses = sla.policy?.pauseStatuses ?? [];
  const data: Partial<Ticket> = { status: to };
  let paused = t.pausedBusinessMinutes;
  // saindo de pausa: acumula minutos úteis pausados e recalcula o prazo de solução
  if (t.pausedAt && !pauses.includes(to)) {
    paused += businessMinutesBetween(t.pausedAt, now, sla.calendar);
    data.pausedAt = null;
    data.pausedBusinessMinutes = paused;
    const target = sla.targets[t.priority];
    if (target) data.resolutionDueAt = addBusinessMinutes(t.openedAt, target.resolutionMinutes + paused, sla.calendar);
  }
  if (!t.pausedAt && pauses.includes(to)) data.pausedAt = now;
  if (!t.firstResponseAt && !isClient(ctx) && to !== "CANCELED") {
    data.firstResponseAt = now;
    if (t.responseDueAt && now > t.responseDueAt) data.responseBreached = true;
  }
  let reopened = false;
  if (to === "RESOLVED") {
    data.resolvedAt = now;
    const dueAt = (data.resolutionDueAt as Date | undefined) ?? t.resolutionDueAt;
    if (dueAt && now > dueAt) data.resolutionBreached = true;
  }
  if (to === "CLOSED") data.closedAt = now;
  if (to === "IN_PROGRESS" && (t.status === "RESOLVED" || t.status === "CLOSED")) {
    const ref = t.resolvedAt ?? t.closedAt ?? now;
    const windowDays = sla.policy?.reopenWindowDays ?? 7;
    if (now.getTime() - ref.getTime() > windowDays * 86_400_000) throw rule(`Prazo de reabertura (${windowDays} dias) expirado: abra um novo chamado.`);
    Object.assign(data, { resolvedAt: null, closedAt: null, reopenCount: t.reopenCount + 1 });
    reopened = true;
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id }, data });
    await event(ctx, tx, id, reopened ? "REOPEN" : "STATUS", t.status, to);
    if (note?.trim()) await tx.ticketComment.create({ data: { organizationId: ctx.orgId, ticketId: id, authorUserId: ctx.userId, authorName: ctx.userName, visibility: isClient(ctx) ? "PUBLIC" : "INTERNAL", body: note.trim() } });
    await audit(ctx, { action: "ticket.status", entity: "Ticket", entityId: id, changes: { from: t.status, to }, reason: note }, tx);
  });
  if (reopened) await notify(ctx.orgId, await usersWithPermission(ctx.orgId, "ams.manage"), { title: `Chamado ${t.number} reaberto`, link: `/app/ams/chamados/${id}` });
}

// ------------------------------------------------------------------ Comentários, atribuição, prioridade, problema, satisfação
export async function addComment(ctx: Ctx, id: string, body: string, visibility: "PUBLIC" | "INTERNAL" = "PUBLIC", now = new Date()) {
  requireWritable(ctx);
  const t = await getTicket(ctx, id);
  if (!body.trim()) throw validation("Escreva o comentário.");
  if (!isClient(ctx)) requirePerm(ctx, "ams.write");
  const vis = isClient(ctx) ? "PUBLIC" : visibility;
  await ctx.db.$transaction(async (tx) => {
    await tx.ticketComment.create({ data: { organizationId: ctx.orgId, ticketId: id, authorUserId: ctx.userId, authorName: ctx.userName, visibility: vis, body: body.trim() } });
    // primeira resposta = primeiro retorno público da equipe
    if (!isClient(ctx) && vis === "PUBLIC" && !t.firstResponseAt) await tx.ticket.update({ where: { id }, data: { firstResponseAt: now, responseBreached: !!t.responseDueAt && now > t.responseDueAt } });
  });
  if (isClient(ctx) && t.assigneeProfessionalId) {
    const m = await prisma.membership.findFirst({ where: { organizationId: ctx.orgId, professionalId: t.assigneeProfessionalId, active: true } });
    if (m) await notify(ctx.orgId, [m.userId], { title: `Nova mensagem do cliente no chamado ${t.number}`, link: `/app/ams/chamados/${id}` });
  }
}

export async function assignTicket(ctx: Ctx, id: string, professionalId: string | null, team?: string | null) {
  requirePerm(ctx, "ams.write");
  requireWritable(ctx);
  const t = await getTicket(ctx, id);
  if (professionalId && !(await ctx.db.professional.findFirst({ where: { id: professionalId, active: true } }))) throw validation("Profissional inválido.");
  await ctx.db.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id }, data: { assigneeProfessionalId: professionalId, team: team ?? t.team } });
    await event(ctx, tx, id, "ASSIGN", t.assigneeProfessionalId, professionalId);
  });
  if (professionalId) {
    const m = await prisma.membership.findFirst({ where: { organizationId: ctx.orgId, professionalId, active: true } });
    if (m) await notify(ctx.orgId, [m.userId], { title: `Chamado ${t.number} atribuído a você`, body: t.title, link: `/app/ams/chamados/${id}` });
  }
}

export async function changePriority(ctx: Ctx, id: string, impact: number, urgency: number, reason: string) {
  requirePerm(ctx, "ams.write");
  requireWritable(ctx);
  if (!reason.trim()) throw validation("Justifique a alteração de prioridade.");
  const t = await getTicket(ctx, id);
  if (!OPEN_STATUSES.includes(t.status)) throw rule("Chamado não está aberto.");
  const priority = priorityFrom(impact, urgency);
  const sla = await loadSla(ctx.orgId, t.slaPolicyId, ctx.timezone);
  const due = dueDates(sla, priority, t.openedAt, t.pausedBusinessMinutes);
  await ctx.db.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id }, data: { impact, urgency, priority, responseDueAt: t.firstResponseAt ? t.responseDueAt : due.responseDueAt, resolutionDueAt: due.resolutionDueAt } });
    await event(ctx, tx, id, "PRIORITY", t.priority, priority);
    await audit(ctx, { action: "ticket.priority", entity: "Ticket", entityId: id, changes: { from: t.priority, to: priority }, reason }, tx);
  });
}

export async function linkProblem(ctx: Ctx, id: string, problemId: string | null) {
  requireWritable(ctx);
  requirePerm(ctx, "ams.write");
  const t = await getTicket(ctx, id);
  if (problemId) {
    const p = await ctx.db.ticket.findFirst({ where: { id: problemId } });
    if (!p || p.type !== "PROBLEM") throw validation("Selecione um chamado do tipo problema.");
    if (p.id === t.id) throw validation("Um problema não pode ser vinculado a si mesmo.");
  }
  await ctx.db.ticket.update({ where: { id }, data: { problemTicketId: problemId } });
  await audit(ctx, { action: "ticket.problem", entity: "Ticket", entityId: id, changes: { problemId } });
}

export async function rateTicket(ctx: Ctx, id: string, score: number, comment?: string) {
  requireWritable(ctx);
  const t = await getTicket(ctx, id);
  if (!isClient(ctx)) requirePerm(ctx, "ams.write");
  if (!["RESOLVED", "CLOSED"].includes(t.status)) throw rule("Avalie após a solução.");
  if (score < 1 || score > 5) throw validation("Nota de 1 a 5.");
  await ctx.db.ticket.update({ where: { id }, data: { csatScore: score, csatComment: comment ?? null } });
  await audit(ctx, { action: "ticket.csat", entity: "Ticket", entityId: id, changes: { score } });
}

// ------------------------------------------------------------------ Situação de SLA (exibição)
export async function slaView(ctx: Ctx, t: Ticket, now = new Date()) {
  const sla = await loadSla(ctx.orgId, t.slaPolicyId, ctx.timezone);
  const target = sla.targets[t.priority];
  if (!target) return null;
  const pausedNow = t.pausedAt ? businessMinutesBetween(t.pausedAt, now, sla.calendar) : 0;
  const end = t.resolvedAt ?? now;
  const consumed = slaConsumedPct(t.openedAt, end, target.resolutionMinutes, t.pausedBusinessMinutes + pausedNow, sla.calendar);
  return { target, consumedPct: consumed, paused: !!t.pausedAt, pausedMinutes: t.pausedBusinessMinutes + pausedNow, calendar: sla.calendar, policyName: sla.policy?.name ?? "—", atRisk: consumed >= target.escalateAfterPct && consumed < 100 };
}

// ------------------------------------------------------------------ Varredura (job): violações, escalonamento, encerramento automático
export async function slaSweep(now = new Date(), orgId?: string) {
  const open = await prisma.ticket.findMany({ where: { ...(orgId ? { organizationId: orgId } : {}), status: { in: OPEN_STATUSES } } });
  const out = { responseBreaches: 0, resolutionBreaches: 0, escalations: 0, autoClosed: 0 };
  const cache = new Map<string, Awaited<ReturnType<typeof loadSla>>>();
  const tzOf = new Map<string, string>();
  const setup = async (t: Ticket) => {
    const key = `${t.organizationId}:${t.slaPolicyId ?? ""}`;
    if (!cache.has(key)) {
      if (!tzOf.has(t.organizationId)) tzOf.set(t.organizationId, (await prisma.organization.findUniqueOrThrow({ where: { id: t.organizationId } })).timezone);
      cache.set(key, await loadSla(t.organizationId, t.slaPolicyId, tzOf.get(t.organizationId)!));
    }
    return cache.get(key)!;
  };
  const ev = (t: Ticket, kind: string, toValue: string) => prisma.ticketEvent.create({ data: { organizationId: t.organizationId, ticketId: t.id, kind, fromValue: null, toValue, byUserId: null } });
  for (const t of open) {
    const sla = await setup(t);
    const target = sla.targets[t.priority];
    if (!target) continue;
    const link = `/app/ams/chamados/${t.id}`;
    if (!t.firstResponseAt && !t.responseBreached && t.responseDueAt && now > t.responseDueAt) {
      await prisma.ticket.update({ where: { id: t.id }, data: { responseBreached: true } });
      await ev(t, "SLA_BREACH", "RESPONSE");
      await notify(t.organizationId, await usersWithPermission(t.organizationId, "ams.manage"), { title: `SLA de resposta violado — ${t.number}`, body: t.title, link });
      out.responseBreaches++;
    }
    if (t.pausedAt) continue; // pausado: prazo de solução congelado
    const consumed = slaConsumedPct(t.openedAt, now, target.resolutionMinutes, t.pausedBusinessMinutes, sla.calendar);
    if (consumed >= 100 && !t.resolutionBreached) {
      await prisma.ticket.update({ where: { id: t.id }, data: { resolutionBreached: true, escalationLevel: Math.max(2, t.escalationLevel) } });
      await ev(t, "SLA_BREACH", "RESOLUTION");
      await notify(t.organizationId, await usersWithPermission(t.organizationId, "ams.manage"), { title: `SLA de solução violado — ${t.number} (${t.priority})`, body: t.title, link });
      out.resolutionBreaches++;
    } else if (consumed >= target.escalateAfterPct && consumed < 100 && t.escalationLevel < 1) {
      await prisma.ticket.update({ where: { id: t.id }, data: { escalationLevel: 1 } });
      await ev(t, "ESCALATION", "1");
      await notify(t.organizationId, await usersWithPermission(t.organizationId, "ams.manage"), { title: `Chamado ${t.number} em risco de SLA (${consumed}% do prazo)`, body: t.title, link });
      out.escalations++;
    }
  }
  // encerramento automático de resolvidos sem manifestação do cliente
  const resolved = await prisma.ticket.findMany({ where: { ...(orgId ? { organizationId: orgId } : {}), status: "RESOLVED" } });
  for (const t of resolved) {
    const sla = await setup(t);
    const days = sla.policy?.autoCloseDays ?? 5;
    if (t.resolvedAt && now.getTime() - t.resolvedAt.getTime() > days * 86_400_000) {
      await prisma.ticket.update({ where: { id: t.id }, data: { status: "CLOSED", closedAt: now } });
      await ev(t, "STATUS", "CLOSED");
      out.autoClosed++;
    }
  }
  return out;
}

/** Comentários do chamado: cliente vê apenas os públicos. */
export async function listComments(ctx: Ctx, ticketId: string) {
  await getTicket(ctx, ticketId);
  return ctx.db.ticketComment.findMany({ where: { ticketId, ...(isClient(ctx) ? { visibility: "PUBLIC" } : {}) }, orderBy: { createdAt: "asc" } });
}
