import { z } from "zod";
import { requirePerm, requireWritable, type Ctx } from "@/server/context";
import { audit, diff } from "@/server/audit";
import { nextNumber } from "@/server/sequences";
import { notFound, rule, validation } from "@/lib/errors";
import { zArray, zDate, zDecimal, zOptDate, zOptId, zOptStr, zStr } from "@/lib/zod-helpers";
import { civil, diffDays, toCivil, todayIn, monthKey } from "@/lib/dates";
import { dec, money, sum, pct } from "@/lib/money";
import { textSearch, type PageQuery } from "@/lib/query";
import { createParty } from "../parties/service";
import { validateCustomFields } from "../config/custom-fields";

// ------------------------------------------------------------------ Leads
export const leadSchema = z.object({
  name: zStr(2, "Informe o nome do contato"), companyName: zOptStr, email: z.preprocess((v) => (v === "" ? undefined : v), z.string().email().optional()),
  phone: zOptStr, source: zOptStr, serviceInterest: zOptStr, ownerUserId: zOptId, notes: zOptStr,
});

export async function createLead(ctx: Ctx, i: z.infer<typeof leadSchema>) {
  requirePerm(ctx, "crm.write");
  requireWritable(ctx);
  const l = await ctx.db.lead.create({ data: { organizationId: ctx.orgId, name: i.name, companyName: i.companyName ?? null, email: i.email ?? null, phone: i.phone ?? null, source: i.source ?? null, serviceInterest: i.serviceInterest ?? null, ownerUserId: i.ownerUserId ?? ctx.userId, notes: i.notes ?? null } });
  await audit(ctx, { action: "lead.create", entity: "Lead", entityId: l.id });
  return l;
}

export async function setLeadStatus(ctx: Ctx, id: string, status: "QUALIFIED" | "DISQUALIFIED") {
  requirePerm(ctx, "crm.write");
  requireWritable(ctx);
  const l = await ctx.db.lead.findFirst({ where: { id } });
  if (!l) throw notFound("Lead");
  if (l.status === "CONVERTED") throw rule("Lead já convertido.");
  await ctx.db.lead.update({ where: { id }, data: { status } });
  await audit(ctx, { action: `lead.${status.toLowerCase()}`, entity: "Lead", entityId: id });
}

/** Converte lead em conta (prospect) + contato + oportunidade, reaproveitando os dados. */
export async function convertLead(ctx: Ctx, id: string, i: { companyId: string; title: string; estimatedValue: string; serviceId?: string; document?: string }) {
  requirePerm(ctx, "crm.write");
  requireWritable(ctx);
  const l = await ctx.db.lead.findFirst({ where: { id } });
  if (!l) throw notFound("Lead");
  if (l.status === "CONVERTED") throw rule("Lead já convertido.");
  const party = await createParty(ctx, { personType: "COMPANY", name: l.companyName || l.name, document: i.document, email: l.email ?? undefined, phone: l.phone ?? undefined, isProspect: true, isCustomer: false, isSupplier: false, isPartner: false, ownerUserId: l.ownerUserId ?? undefined });
  await ctx.db.contact.create({ data: { organizationId: ctx.orgId, partyId: party.id, name: l.name, email: l.email, phone: l.phone, roles: ["DECISOR"] } });
  const opp = await createOpportunity(ctx, { companyId: i.companyId, partyId: party.id, title: i.title, estimatedValue: i.estimatedValue, source: l.source ?? undefined, ownerUserId: l.ownerUserId ?? undefined, competitors: [], kind: "NEW", serviceIds: i.serviceId ? [i.serviceId] : [], itemModels: i.serviceId ? ["TIME_MATERIAL"] : [], itemValues: i.serviceId ? [i.estimatedValue] : [] });
  await ctx.db.lead.update({ where: { id }, data: { status: "CONVERTED", convertedPartyId: party.id, convertedOpportunityId: opp.id } });
  await audit(ctx, { action: "lead.convert", entity: "Lead", entityId: id, changes: { partyId: party.id, opportunityId: opp.id } });
  return { party, opp };
}

// ------------------------------------------------------------------ Oportunidades
export const opportunitySchema = z.object({
  companyId: z.string().min(1, "Selecione a empresa"),
  partyId: z.string().min(1, "Selecione o cliente"),
  title: zStr(3, "Informe o título"),
  stageId: zOptId,
  estimatedValue: zDecimal,
  probability: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.coerce.number().int().min(0).max(100).optional()),
  expectedCloseDate: zOptDate,
  source: zOptStr,
  ownerUserId: zOptId,
  partnerPartyId: zOptId,
  competitors: z.preprocess((v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : v ?? []), z.array(z.string())),
  nextAction: zOptStr,
  nextActionDate: zOptDate,
  kind: z.enum(["NEW", "RENEWAL", "UPSELL", "CROSS_SELL"]).default("NEW"),
  serviceIds: zArray,
  itemModels: zArray,
  itemValues: zArray,
}).passthrough();
export type OpportunityInput = z.infer<typeof opportunitySchema>;

async function saveItems(ctx: Ctx, opportunityId: string, i: OpportunityInput) {
  await ctx.db.opportunityItem.deleteMany({ where: { opportunityId } });
  const rows = i.serviceIds.map((serviceId, idx) => ({ serviceId, commercialModel: i.itemModels[idx] || "TIME_MATERIAL", estimatedValue: money(i.itemValues[idx] || "0") })).filter((r) => r.serviceId);
  for (const r of rows) if (!(await ctx.db.service.findFirst({ where: { id: r.serviceId } }))) throw validation("Serviço inválido.");
  if (rows.length) await ctx.db.opportunityItem.createMany({ data: rows.map((r) => ({ organizationId: ctx.orgId, opportunityId, ...r })) });
  return rows;
}

export async function createOpportunity(ctx: Ctx, i: OpportunityInput) {
  requirePerm(ctx, "crm.write");
  requireWritable(ctx);
  const party = await ctx.db.party.findFirst({ where: { id: i.partyId } });
  if (!party || !(party.isCustomer || party.isProspect)) throw validation("Cliente/prospect inválido.");
  const stage = i.stageId ? await ctx.db.pipelineStage.findFirst({ where: { id: i.stageId } }) : await ctx.db.pipelineStage.findFirst({ where: { kind: "OPEN", active: true }, orderBy: { order: "asc" } });
  if (!stage || stage.kind !== "OPEN") throw validation("Etapa inicial inválida.");
  const customFields = await validateCustomFields(ctx, "OPPORTUNITY", i as Record<string, unknown>);
  const opp = await ctx.db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "OPPORTUNITY");
    return tx.opportunity.create({
      data: {
        organizationId: ctx.orgId, companyId: i.companyId, number, partyId: i.partyId, title: i.title, stageId: stage.id, ownerUserId: i.ownerUserId ?? ctx.userId, source: i.source ?? null,
        estimatedValue: money(i.estimatedValue), probability: i.probability ?? stage.probability, expectedCloseDate: i.expectedCloseDate ? civil(i.expectedCloseDate) : null,
        competitors: i.competitors, nextAction: i.nextAction ?? null, nextActionDate: i.nextActionDate ? civil(i.nextActionDate) : null, partnerPartyId: i.partnerPartyId ?? null,
        kind: i.kind, customFields, lastActivityAt: new Date(),
      },
    });
  });
  const items = await saveItems(ctx, opp.id, i);
  // Valor estimado = soma dos itens quando informados
  if (items.length) await ctx.db.opportunity.update({ where: { id: opp.id }, data: { estimatedValue: money(sum(items.map((x) => x.estimatedValue))) } });
  await audit(ctx, { action: "opportunity.create", entity: "Opportunity", entityId: opp.id, companyId: i.companyId, changes: { title: i.title, value: i.estimatedValue } });
  return opp;
}

export async function updateOpportunity(ctx: Ctx, id: string, i: OpportunityInput) {
  requirePerm(ctx, "crm.write");
  requireWritable(ctx);
  const before = await ctx.db.opportunity.findFirst({ where: { id } });
  if (!before) throw notFound("Oportunidade");
  if (before.status !== "OPEN") throw rule("Oportunidade encerrada não pode ser editada. Reabra-a.");
  const customFields = await validateCustomFields(ctx, "OPPORTUNITY", i as Record<string, unknown>);
  const items = await saveItems(ctx, id, i);
  const after = await ctx.db.opportunity.update({
    where: { id },
    data: {
      title: i.title, partyId: i.partyId, ownerUserId: i.ownerUserId ?? before.ownerUserId, source: i.source ?? null, estimatedValue: items.length ? money(sum(items.map((x) => x.estimatedValue))) : money(i.estimatedValue),
      probability: i.probability ?? before.probability, expectedCloseDate: i.expectedCloseDate ? civil(i.expectedCloseDate) : null, competitors: i.competitors,
      nextAction: i.nextAction ?? null, nextActionDate: i.nextActionDate ? civil(i.nextActionDate) : null, partnerPartyId: i.partnerPartyId ?? null, kind: i.kind, customFields,
    },
  });
  await audit(ctx, { action: "opportunity.update", entity: "Opportunity", entityId: id, companyId: after.companyId, changes: diff(before, after) });
  return after;
}

export async function moveStage(ctx: Ctx, id: string, stageId: string) {
  requirePerm(ctx, "crm.write");
  requireWritable(ctx);
  const opp = await ctx.db.opportunity.findFirst({ where: { id } });
  if (!opp) throw notFound("Oportunidade");
  if (opp.status !== "OPEN") throw rule("Oportunidade encerrada.");
  const stage = await ctx.db.pipelineStage.findFirst({ where: { id: stageId } });
  if (!stage) throw validation("Etapa inválida.");
  if (stage.kind !== "OPEN") throw rule("Use as ações Ganhar/Perder para encerrar a oportunidade.");
  await ctx.db.opportunity.update({ where: { id }, data: { stageId, probability: stage.probability, lastActivityAt: new Date() } });
  await audit(ctx, { action: "opportunity.stage", entity: "Opportunity", entityId: id, changes: { from: opp.stageId, to: stageId } });
}

export async function winOpportunity(ctx: Ctx, id: string) {
  requirePerm(ctx, "crm.write");
  requireWritable(ctx);
  const opp = await ctx.db.opportunity.findFirst({ where: { id } });
  if (!opp) throw notFound("Oportunidade");
  if (opp.status === "WON") return opp;
  const won = await ctx.db.pipelineStage.findFirst({ where: { kind: "WON" } });
  const r = await ctx.db.opportunity.update({ where: { id }, data: { status: "WON", stageId: won?.id ?? opp.stageId, probability: 100, wonAt: new Date(), lossReasonId: null } });
  // Prospect vira cliente
  await ctx.db.party.update({ where: { id: opp.partyId }, data: { isCustomer: true, isProspect: false } });
  await audit(ctx, { action: "opportunity.win", entity: "Opportunity", entityId: id, companyId: opp.companyId });
  return r;
}

export async function loseOpportunity(ctx: Ctx, id: string, lossReasonId: string, notes?: string) {
  requirePerm(ctx, "crm.write");
  requireWritable(ctx);
  const opp = await ctx.db.opportunity.findFirst({ where: { id } });
  if (!opp) throw notFound("Oportunidade");
  if (opp.status !== "OPEN") throw rule("Oportunidade já encerrada.");
  if (!(await ctx.db.lossReason.findFirst({ where: { id: lossReasonId } }))) throw validation("Informe o motivo da perda.");
  const lost = await ctx.db.pipelineStage.findFirst({ where: { kind: "LOST" } });
  await ctx.db.opportunity.update({ where: { id }, data: { status: "LOST", stageId: lost?.id ?? opp.stageId, probability: 0, lostAt: new Date(), lossReasonId, lossNotes: notes ?? null } });
  await audit(ctx, { action: "opportunity.lose", entity: "Opportunity", entityId: id, companyId: opp.companyId, reason: notes, changes: { lossReasonId } });
}

export async function reopenOpportunity(ctx: Ctx, id: string) {
  requireWritable(ctx);
  requirePerm(ctx, "crm.write");
  const opp = await ctx.db.opportunity.findFirst({ where: { id } });
  if (!opp || opp.status === "OPEN") throw rule("Nada a reabrir.");
  if (await ctx.db.salesOrder.findFirst({ where: { opportunityId: id, status: { not: "CANCELED" } } })) throw rule("Já existe pedido de venda para esta oportunidade.");
  const first = await ctx.db.pipelineStage.findFirst({ where: { kind: "OPEN", active: true }, orderBy: { order: "desc" } });
  await ctx.db.opportunity.update({ where: { id }, data: { status: "OPEN", stageId: first!.id, probability: first!.probability, wonAt: null, lostAt: null } });
  await audit(ctx, { action: "opportunity.reopen", entity: "Opportunity", entityId: id });
}

// ------------------------------------------------------------------ Atividades e interações
export const activitySchema = z.object({
  type: z.enum(["CALL", "MEETING", "TASK", "EMAIL", "NOTE", "DECISION"]), subject: zStr(2), notes: zOptStr,
  dueAt: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()), done: z.preprocess((v) => v === "on" || v === true, z.boolean()),
  partyId: zOptId, opportunityId: zOptId, leadId: zOptId, projectId: zOptId, ownerUserId: zOptId,
});
export async function createActivity(ctx: Ctx, i: z.infer<typeof activitySchema>) {
  requirePerm(ctx, "crm.write");
  requireWritable(ctx);
  let partyId = i.partyId ?? null;
  if (i.opportunityId) {
    const o = await ctx.db.opportunity.findFirst({ where: { id: i.opportunityId } });
    if (!o) throw notFound("Oportunidade");
    partyId = o.partyId;
    await ctx.db.opportunity.update({ where: { id: o.id }, data: { lastActivityAt: new Date() } });
  }
  const dueAt = i.dueAt ? new Date(i.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) throw validation("Data/hora inválida.");
  const a = await ctx.db.activity.create({ data: { organizationId: ctx.orgId, type: i.type, subject: i.subject, notes: i.notes ?? null, dueAt, doneAt: i.done ? new Date() : null, ownerUserId: i.ownerUserId ?? ctx.userId, partyId, opportunityId: i.opportunityId ?? null, leadId: i.leadId ?? null, projectId: i.projectId ?? null, createdById: ctx.userId } });
  await audit(ctx, { action: "activity.create", entity: "Activity", entityId: a.id });
  return a;
}
export async function completeActivity(ctx: Ctx, id: string) {
  requireWritable(ctx);
  requirePerm(ctx, "crm.write");
  const a = await ctx.db.activity.findFirst({ where: { id } });
  if (!a) throw notFound("Atividade");
  await ctx.db.activity.update({ where: { id }, data: { doneAt: new Date() } });
  if (a.opportunityId) await ctx.db.opportunity.update({ where: { id: a.opportunityId }, data: { lastActivityAt: new Date() } });
}

// ------------------------------------------------------------------ Consultas e indicadores
export async function listOpportunities(ctx: Ctx, q: PageQuery, f: { status?: string; stageId?: string; ownerUserId?: string; partyId?: string } = {}) {
  requirePerm(ctx, "crm.read");
  const where = { AND: [textSearch(q.q, ["title", "number"]), f.status ? { status: f.status } : {}, f.stageId ? { stageId: f.stageId } : {}, f.ownerUserId ? { ownerUserId: f.ownerUserId } : {}, f.partyId ? { partyId: f.partyId } : {}] };
  const [rows, total] = await Promise.all([ctx.db.opportunity.findMany({ where, orderBy: { updatedAt: "desc" }, skip: q.skip, take: q.take }), ctx.db.opportunity.count({ where })]);
  return { rows, total };
}

export const STALE_DAYS = 14;

/**
 * Indicadores comerciais (docs/FORMULAS.md):
 * - Pipeline bruto = Σ valor estimado das oportunidades abertas
 * - Pipeline ponderado = Σ valor × probabilidade
 * - Conversão = ganhas ÷ (ganhas + perdidas) no período
 * - Tempo médio de venda = média (data de ganho − data de criação) em dias
 * - Sem atividade = abertas sem interação há mais de 14 dias
 * - Previsão por mês = Σ ponderado por mês da data prevista de fechamento
 */
export async function crmMetrics(ctx: Ctx, opts: { from?: string; to?: string } = {}) {
  requirePerm(ctx, "crm.read");
  const today = todayIn(ctx.timezone);
  const all = await ctx.db.opportunity.findMany();
  const open = all.filter((o) => o.status === "OPEN");
  const inRange = (d: Date | null) => !!d && (!opts.from || toCivil(d) >= opts.from) && (!opts.to || toCivil(d) <= opts.to);
  const won = all.filter((o) => o.status === "WON" && inRange(o.wonAt));
  const lost = all.filter((o) => o.status === "LOST" && inRange(o.lostAt));
  const items = await ctx.db.opportunityItem.findMany({ where: { opportunityId: { in: won.map((w) => w.id) } } });
  const weighted = (o: (typeof all)[number]) => money(dec(o.estimatedValue).times(o.probability).div(100));
  const staleLimit = new Date(Date.now() - STALE_DAYS * 86400000);
  const forecast = new Map<string, ReturnType<typeof money>>();
  for (const o of open) {
    const k = o.expectedCloseDate ? monthKey(o.expectedCloseDate) : "sem data";
    forecast.set(k, (forecast.get(k) ?? money(0)).plus(weighted(o)));
  }
  const group = <K extends string>(rows: typeof won, key: (o: (typeof won)[number]) => K) => {
    const m = new Map<K, ReturnType<typeof money>>();
    for (const o of rows) m.set(key(o), (m.get(key(o)) ?? money(0)).plus(dec(o.estimatedValue)));
    return [...m.entries()].sort((a, b) => b[1].comparedTo(a[1]));
  };
  const byService = new Map<string, ReturnType<typeof money>>();
  for (const it of items) byService.set(it.serviceId, (byService.get(it.serviceId) ?? money(0)).plus(dec(it.estimatedValue)));
  return {
    openCount: open.length,
    pipelineGross: money(sum(open.map((o) => o.estimatedValue))),
    pipelineWeighted: money(sum(open.map(weighted))),
    wonCount: won.length, lostCount: lost.length,
    wonValue: money(sum(won.map((o) => o.estimatedValue))),
    conversionPct: pct(won.length, won.length + lost.length),
    avgCycleDays: won.length ? Math.round(won.reduce((a, o) => a + diffDays(toCivil(o.createdAt), toCivil(o.wonAt!)), 0) / won.length) : null,
    stale: open.filter((o) => !o.lastActivityAt || o.lastActivityAt < staleLimit),
    overdueNextActions: open.filter((o) => o.nextActionDate && toCivil(o.nextActionDate) < today),
    forecast: [...forecast.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    byOwner: group(won, (o) => (o.ownerUserId ?? "—") as string),
    byCustomer: group(won, (o) => o.partyId as string),
    byService: [...byService.entries()].sort((a, b) => b[1].comparedTo(a[1])),
  };
}

export function staleDays(o: { lastActivityAt: Date | null }) {
  if (!o.lastActivityAt) return null;
  return Math.floor((Date.now() - o.lastActivityAt.getTime()) / 86400000);
}

export const zDateTime = zDate;
