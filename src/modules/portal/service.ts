/**
 * Portal do cliente — camada de leitura: toda consulta é filtrada pela parte (cliente) do usuário e devolve apenas
 * campos voltados ao cliente (sem custos, margens, comentários internos ou dados de outros clientes).
 */
import type { Ctx } from "@/server/context";
import { forbidden } from "@/lib/errors";
import { dec, money, sum } from "@/lib/money";
import { OPEN_STATUSES } from "../ams/tickets";

export function portalScope(ctx: Ctx) {
  if (ctx.kind !== "CLIENT" || !ctx.permissions.has("portal.access") || !ctx.partyId) throw forbidden("Acesso restrito ao portal do cliente.");
  return ctx.partyId;
}

export async function portalOverview(ctx: Ctx) {
  const partyId = portalScope(ctx);
  const contracts = await ctx.db.contract.findMany({ where: { partyId, status: { in: ["ACTIVE", "SUSPENDED", "ENDED"] } }, select: { id: true, number: true, title: true, status: true, startDate: true, endDate: true, commercialModel: true }, orderBy: { startDate: "desc" } });
  const ids = contracts.map((c) => c.id);
  const [openTickets, timePending, measPending, deliverables, receivables] = await Promise.all([
    ctx.db.ticket.count({ where: { partyId, status: { in: OPEN_STATUSES } } }),
    ctx.db.timeEntry.count({ where: { contractId: { in: ids }, clientApproval: "PENDING", status: "APPROVED" } }),
    ctx.db.measurement.count({ where: { partyId, status: "CLIENT_PENDING" } }),
    ctx.db.projectTask.count({ where: { requiresAcceptance: true, OR: [{ acceptanceStatus: "PENDING" }, { acceptanceStatus: null }], status: "DONE", projectId: { in: (await ctx.db.project.findMany({ where: { partyId }, select: { id: true } })).map((p) => p.id) } } }),
    ctx.db.receivable.findMany({ where: { partyId, status: { in: ["OPEN", "PARTIAL"] } }, select: { openAmount: true, dueDate: true } }),
  ]);
  return { contracts, openTickets, timePending, measPending, deliverables, openReceivables: money(sum(receivables.map((r) => r.openAmount))), overdue: receivables.filter((r) => r.dueDate < new Date()).length };
}

export async function portalPendingTime(ctx: Ctx) {
  const partyId = portalScope(ctx);
  const contracts = await ctx.db.contract.findMany({ where: { partyId }, select: { id: true, number: true } });
  const rows = await ctx.db.timeEntry.findMany({ where: { contractId: { in: contracts.map((c) => c.id) }, clientApproval: "PENDING", status: "APPROVED" }, orderBy: { date: "asc" }, select: { id: true, date: true, hours: true, description: true, professionalId: true, projectId: true, contractId: true, sellRate: true } });
  const profs = new Map((await ctx.db.professional.findMany({ where: { id: { in: rows.map((r) => r.professionalId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const cn = new Map(contracts.map((c) => [c.id, c.number]));
  return rows.map((r) => ({ id: r.id, date: r.date, hours: r.hours, description: r.description, professional: profs.get(r.professionalId) ?? "", contract: cn.get(r.contractId ?? "") ?? "", rate: r.sellRate, amount: r.sellRate ? money(dec(r.hours).times(r.sellRate)) : null }));
}

export async function portalMeasurements(ctx: Ctx) {
  const partyId = portalScope(ctx);
  const ms = await ctx.db.measurement.findMany({ where: { partyId, status: { in: ["CLIENT_PENDING", "CLIENT_APPROVED", "APPROVED", "PARTIALLY_INVOICED", "INVOICED"] } }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, number: true, status: true, periodStart: true, periodEnd: true, competence: true, totalAmount: true, clientApprovedByName: true, clientApprovedAt: true } });
  const items = await ctx.db.measurementItem.findMany({ where: { measurementId: { in: ms.map((m) => m.id) }, status: { not: "REMOVED" } }, select: { measurementId: true, description: true, quantity: true, unitPrice: true, amount: true, sourceType: true } });
  return ms.map((m) => ({ ...m, items: items.filter((i) => i.measurementId === m.id) }));
}

export async function portalProjects(ctx: Ctx) {
  const partyId = portalScope(ctx);
  const projects = await ctx.db.project.findMany({ where: { partyId, status: { not: "CANCELED" } }, select: { id: true, code: true, name: true, status: true, plannedStart: true, plannedEnd: true }, orderBy: { code: "asc" } });
  const ids = projects.map((p) => p.id);
  const [reports, logs, deliverables, tasks] = await Promise.all([
    ctx.db.statusReport.findMany({ where: { projectId: { in: ids }, clientVisible: true }, orderBy: { createdAt: "desc" }, select: { id: true, projectId: true, overall: true, schedule: true, scope: true, summary: true, nextSteps: true, createdAt: true } }),
    ctx.db.projectLog.findMany({ where: { projectId: { in: ids }, clientVisible: true }, orderBy: { createdAt: "desc" }, select: { id: true, projectId: true, kind: true, title: true, status: true, dueDate: true, ownerName: true } }),
    ctx.db.projectTask.findMany({ where: { projectId: { in: ids }, requiresAcceptance: true }, select: { id: true, projectId: true, name: true, status: true, plannedEnd: true, acceptanceStatus: true, acceptedByName: true, acceptedAt: true } }),
    ctx.db.projectTask.findMany({ where: { projectId: { in: ids }, kind: { not: "PHASE" } }, select: { projectId: true, status: true, weight: true } }),
  ]);
  return projects.map((p) => {
    const ts = tasks.filter((t) => t.projectId === p.id);
    const total = sum(ts.map((t) => t.weight));
    const done = sum(ts.filter((t) => t.status === "DONE").map((t) => t.weight));
    return { ...p, progressPct: total.isZero() ? null : done.div(total).times(100), reports: reports.filter((r) => r.projectId === p.id), logs: logs.filter((l) => l.projectId === p.id), deliverables: deliverables.filter((d) => d.projectId === p.id) };
  });
}

export async function portalFinance(ctx: Ctx) {
  const partyId = portalScope(ctx);
  const docs = await ctx.db.billingDocument.findMany({ where: { partyId, status: "ISSUED" }, orderBy: { issueDate: "desc" }, take: 50, select: { id: true, number: true, issueDate: true, competence: true, grossAmount: true, withholdingAmount: true, netAmount: true, fiscalStatus: true, customerPo: true } });
  const [recs, fiscal] = await Promise.all([
    ctx.db.receivable.findMany({ where: { partyId, status: { not: "CANCELED" } }, orderBy: { dueDate: "desc" }, take: 100, select: { id: true, number: true, billingDocumentId: true, installment: true, installments: true, dueDate: true, amount: true, openAmount: true, status: true } }),
    ctx.db.fiscalDocument.findMany({ where: { billingDocumentId: { in: docs.map((d) => d.id) }, status: "AUTHORIZED" }, select: { billingDocumentId: true, number: true, verificationCode: true, environment: true } }),
  ]);
  return { docs: docs.map((d) => ({ ...d, fiscal: fiscal.find((f) => f.billingDocumentId === d.id) ?? null })), receivables: recs };
}
