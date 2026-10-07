import { z } from "zod";
import { requirePerm, requireWritable, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { setSetting, SETTING_DEFAULTS, type SettingKey } from "@/server/settings";
import { conflict, notFound, validation } from "@/lib/errors";
import { civil, toCivil } from "@/lib/dates";
import { dec, rate, sum } from "@/lib/money";
import { zDate, zDecimal, zOptDate, zOptId, zStr } from "@/lib/zod-helpers";

function guard(ctx: Ctx) {
  requirePerm(ctx, "settings.manage");
  requireWritable(ctx);
}

// ------------------------------------------------------------ Calendários e feriados
export const calendarSchema = z.object({
  id: z.string().optional(), name: zStr(2), timezone: z.string().default("America/Sao_Paulo"),
  h0: zDecimal, h1: zDecimal, h2: zDecimal, h3: zDecimal, h4: zDecimal, h5: zDecimal, h6: zDecimal,
  businessStart: z.string().regex(/^\d{2}:\d{2}$/), businessEnd: z.string().regex(/^\d{2}:\d{2}$/),
});
const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
export async function saveCalendar(ctx: Ctx, i: z.infer<typeof calendarSchema>) {
  requireWritable(ctx);
  guard(ctx);
  const hours = [i.h0, i.h1, i.h2, i.h3, i.h4, i.h5, i.h6];
  if (hours.some((h) => dec(h).lt(0) || dec(h).gt(24))) throw validation("Horas por dia entre 0 e 24.");
  const start = toMin(i.businessStart), end = toMin(i.businessEnd);
  if (end <= start) throw validation("Fim do atendimento deve ser após o início.");
  const data = { name: i.name, timezone: i.timezone, weeklyHours: hours, businessStartMinute: start, businessEndMinute: end };
  const c = i.id ? await ctx.db.workCalendar.update({ where: { id: i.id }, data }) : await ctx.db.workCalendar.create({ data: { organizationId: ctx.orgId, ...data } });
  await audit(ctx, { action: i.id ? "calendar.update" : "calendar.create", entity: "WorkCalendar", entityId: c.id, changes: data });
  return c;
}
export const holidaySchema = z.object({ calendarId: z.string(), date: zDate, name: zStr(2) });
export async function addHoliday(ctx: Ctx, i: z.infer<typeof holidaySchema>) {
  requireWritable(ctx);
  guard(ctx);
  if (!(await ctx.db.workCalendar.findFirst({ where: { id: i.calendarId } }))) throw notFound("Calendário");
  if (await ctx.db.holiday.findFirst({ where: { calendarId: i.calendarId, date: civil(i.date) } })) throw conflict("Já existe feriado nesta data.");
  const h = await ctx.db.holiday.create({ data: { organizationId: ctx.orgId, calendarId: i.calendarId, date: civil(i.date), name: i.name } });
  await audit(ctx, { action: "holiday.create", entity: "Holiday", entityId: h.id, changes: i });
}
export async function removeHoliday(ctx: Ctx, id: string) {
  requireWritable(ctx);
  guard(ctx);
  await ctx.db.holiday.deleteMany({ where: { id } });
  await audit(ctx, { action: "holiday.delete", entity: "Holiday", entityId: id });
}

// ------------------------------------------------------------ Condições de pagamento
export const paymentTermSchema = z.object({ id: z.string().optional(), name: zStr(2), days: z.array(z.coerce.number().int().min(0).max(720)), percents: z.array(zDecimal) });
export async function savePaymentTerm(ctx: Ctx, i: z.infer<typeof paymentTermSchema>) {
  requireWritable(ctx);
  guard(ctx);
  const rows = i.days.map((d, idx) => ({ days: d, percent: i.percents[idx] ?? "0" })).filter((r) => dec(r.percent).gt(0));
  if (!rows.length) throw validation("Informe ao menos uma parcela.");
  if (!sum(rows.map((r) => r.percent)).eq(100)) throw validation("A soma dos percentuais das parcelas deve ser 100%.");
  const sorted = [...rows].sort((a, b) => a.days - b.days);
  const data = { name: i.name, installments: sorted };
  const t = i.id ? await ctx.db.paymentTerm.update({ where: { id: i.id }, data }) : await ctx.db.paymentTerm.create({ data: { organizationId: ctx.orgId, ...data } });
  await audit(ctx, { action: i.id ? "payment_term.update" : "payment_term.create", entity: "PaymentTerm", entityId: t.id, changes: data });
}

// ------------------------------------------------------------ Tabelas de preço com vigência
export const priceTableSchema = z.object({ name: zStr(2), validFrom: zDate, validTo: zOptDate, copyFromId: zOptId });
/** Nova tabela; opcionalmente copia itens de outra (nova vigência sem alterar a anterior). */
export async function createPriceTable(ctx: Ctx, i: z.infer<typeof priceTableSchema>) {
  requireWritable(ctx);
  guard(ctx);
  requirePerm(ctx, "cost.manage");
  if (i.validTo && i.validTo < i.validFrom) throw validation("Vigência final anterior à inicial.");
  const t = await ctx.db.priceTable.create({ data: { organizationId: ctx.orgId, name: i.name, validFrom: civil(i.validFrom), validTo: i.validTo ? civil(i.validTo) : null } });
  if (i.copyFromId) {
    const items = await ctx.db.priceTableItem.findMany({ where: { priceTableId: i.copyFromId } });
    if (items.length) await ctx.db.priceTableItem.createMany({ data: items.map((it) => ({ organizationId: ctx.orgId, priceTableId: t.id, teamRoleId: it.teamRoleId, seniorityId: it.seniorityId, serviceId: it.serviceId, hourlyRate: it.hourlyRate, referenceCost: it.referenceCost })) });
  }
  await audit(ctx, { action: "price_table.create", entity: "PriceTable", entityId: t.id, changes: i });
  return t;
}
export const priceItemSchema = z.object({ priceTableId: z.string(), teamRoleId: zOptId, seniorityId: zOptId, serviceId: zOptId, hourlyRate: zDecimal, referenceCost: zDecimal });
export async function addPriceItem(ctx: Ctx, i: z.infer<typeof priceItemSchema>) {
  requireWritable(ctx);
  guard(ctx);
  requirePerm(ctx, "cost.manage");
  if (dec(i.hourlyRate).lte(0)) throw validation("Tarifa deve ser maior que zero.");
  if (!i.teamRoleId && !i.seniorityId && !i.serviceId) throw validation("Informe papel, senioridade ou serviço.");
  const dup = await ctx.db.priceTableItem.findFirst({ where: { priceTableId: i.priceTableId, teamRoleId: i.teamRoleId ?? null, seniorityId: i.seniorityId ?? null, serviceId: i.serviceId ?? null } });
  const data = { hourlyRate: rate(i.hourlyRate), referenceCost: dec(i.referenceCost).isZero() ? null : rate(i.referenceCost) };
  if (dup) await ctx.db.priceTableItem.update({ where: { id: dup.id }, data });
  else await ctx.db.priceTableItem.create({ data: { organizationId: ctx.orgId, priceTableId: i.priceTableId, teamRoleId: i.teamRoleId ?? null, seniorityId: i.seniorityId ?? null, serviceId: i.serviceId ?? null, ...data } });
  await audit(ctx, { action: "price_item.save", entity: "PriceTable", entityId: i.priceTableId, changes: i });
}

/**
 * Tarifa de referência vigente para papel/senioridade numa data.
 * Documentos (propostas, contratos) gravam snapshot — alterações futuras não os afetam.
 */
export async function referenceRate(ctx: Ctx, date: string, keys: { teamRoleId?: string | null; seniorityId?: string | null; serviceId?: string | null }) {
  const d = civil(date);
  const tables = await ctx.db.priceTable.findMany({ where: { active: true, validFrom: { lte: d }, OR: [{ validTo: null }, { validTo: { gte: d } }] }, orderBy: { validFrom: "desc" } });
  for (const t of tables) {
    const items = await ctx.db.priceTableItem.findMany({ where: { priceTableId: t.id } });
    const score = (it: (typeof items)[number]) =>
      (it.teamRoleId && it.teamRoleId === keys.teamRoleId ? 4 : it.teamRoleId ? -100 : 0) + (it.seniorityId && it.seniorityId === keys.seniorityId ? 2 : it.seniorityId ? -100 : 0) + (it.serviceId && it.serviceId === keys.serviceId ? 1 : it.serviceId ? -100 : 0);
    const best = items.map((it) => ({ it, s: score(it) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0];
    if (best) return { rate: dec(best.it.hourlyRate), referenceCost: best.it.referenceCost ? dec(best.it.referenceCost) : null, tableId: t.id, tableName: t.name, validFrom: toCivil(t.validFrom) };
  }
  return null;
}

// ------------------------------------------------------------ SLA
export const slaSchema = z.object({
  id: z.string().optional(), name: zStr(2), calendarId: zOptId, pauseStatuses: z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.string())),
  reopenWindowDays: z.coerce.number().int().min(0).max(90), autoCloseDays: z.coerce.number().int().min(0).max(90),
  p1r: z.coerce.number().int().positive(), p1s: z.coerce.number().int().positive(), p2r: z.coerce.number().int().positive(), p2s: z.coerce.number().int().positive(),
  p3r: z.coerce.number().int().positive(), p3s: z.coerce.number().int().positive(), p4r: z.coerce.number().int().positive(), p4s: z.coerce.number().int().positive(),
  escalatePct: z.coerce.number().int().min(10).max(100),
});
export async function saveSla(ctx: Ctx, i: z.infer<typeof slaSchema>) {
  requireWritable(ctx);
  guard(ctx);
  const targets = [["P1", i.p1r, i.p1s], ["P2", i.p2r, i.p2s], ["P3", i.p3r, i.p3s], ["P4", i.p4r, i.p4s]] as const;
  for (const [p, r, s] of targets) if (s < r) throw validation(`${p}: prazo de solução deve ser maior ou igual ao de resposta.`);
  const data = { name: i.name, calendarId: i.calendarId ?? null, pauseStatuses: i.pauseStatuses, reopenWindowDays: i.reopenWindowDays, autoCloseDays: i.autoCloseDays };
  const pol = i.id ? await ctx.db.slaPolicy.update({ where: { id: i.id }, data }) : await ctx.db.slaPolicy.create({ data: { organizationId: ctx.orgId, ...data } });
  for (const [priority, responseMinutes, resolutionMinutes] of targets) {
    await ctx.db.slaTarget.upsert({ where: { policyId_priority: { policyId: pol.id, priority } }, create: { organizationId: ctx.orgId, policyId: pol.id, priority, responseMinutes, resolutionMinutes, escalateAfterPct: i.escalatePct }, update: { responseMinutes, resolutionMinutes, escalateAfterPct: i.escalatePct } });
  }
  await audit(ctx, { action: i.id ? "sla.update" : "sla.create", entity: "SlaPolicy", entityId: pol.id, changes: i });
}

// ------------------------------------------------------------ Políticas (configurações gerais)
export const policySchema = z.object({
  requesterCannotApprove: z.preprocess((v) => v === "on", z.boolean()), approverCannotPay: z.preprocess((v) => v === "on", z.boolean()), measurementCreatorCannotApprove: z.preprocess((v) => v === "on", z.boolean()),
  maxHoursPerDay: z.coerce.number().min(1).max(24), allowFutureDays: z.coerce.number().int().min(0).max(30), lockAfterDays: z.coerce.number().int().min(0).max(365), overtimeAfterHoursPerDay: z.coerce.number().min(0).max(24),
  overallocationTolerancePct: z.coerce.number().min(0).max(100), defaultDueDays: z.coerce.number().int().min(0).max(365),
  modules: z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.string())), requireReasonToReopen: z.preprocess((v) => v === "on", z.boolean()),
  revenueApprovedBy: z.string().optional(), revenueNotes: z.string().optional(),
});
export async function savePolicies(ctx: Ctx, i: z.infer<typeof policySchema>) {
  guard(ctx);
  const writes: [SettingKey, object][] = [
    ["sod", { requesterCannotApprove: i.requesterCannotApprove, approverCannotPay: i.approverCannotPay, measurementCreatorCannotApprove: i.measurementCreatorCannotApprove }],
    ["timesheet", { maxHoursPerDay: i.maxHoursPerDay, allowFutureDays: i.allowFutureDays, lockAfterDays: i.lockAfterDays, overtimeAfterHoursPerDay: i.overtimeAfterHoursPerDay }],
    ["allocation", { overallocationTolerancePct: i.overallocationTolerancePct }],
    ["billing", { defaultDueDays: i.defaultDueDays }],
    ["modules", { enabled: i.modules }],
    ["closing", { requireReasonToReopen: i.requireReasonToReopen }],
  ];
  if (i.revenueApprovedBy?.trim()) writes.push(["revenueRecognition", { approvedBy: i.revenueApprovedBy.trim(), approvedAt: new Date().toISOString(), notes: i.revenueNotes ?? SETTING_DEFAULTS.revenueRecognition.notes }]);
  for (const [k, v] of writes) await setSetting(ctx, k, v as never);
  await audit(ctx, { action: "settings.update", entity: "OrgSetting", changes: i });
}

// ------------------------------------------------------------ Numeração
export const sequenceSchema = z.object({ docType: z.string(), prefix: z.string().regex(/^[A-Z0-9-]{1,10}$/, "Prefixo inválido"), nextNumber: z.coerce.number().int().min(1) });
export async function saveSequence(ctx: Ctx, i: z.infer<typeof sequenceSchema>) {
  requireWritable(ctx);
  guard(ctx);
  const cur = await ctx.db.documentSequence.findFirst({ where: { companyId: "", docType: i.docType } });
  if (cur && i.nextNumber < cur.nextNumber) throw validation("Não é permitido retroceder a numeração (evita números duplicados).");
  await ctx.db.documentSequence.upsert({
    where: { organizationId_companyId_docType: { organizationId: ctx.orgId, companyId: "", docType: i.docType } },
    create: { organizationId: ctx.orgId, companyId: "", docType: i.docType, prefix: i.prefix, nextNumber: i.nextNumber },
    update: { prefix: i.prefix, nextNumber: i.nextNumber },
  });
  await audit(ctx, { action: "sequence.update", entity: "DocumentSequence", changes: i });
}

// ------------------------------------------------------------ Integrações
export const INTEGRATION_KINDS = [
  { kind: "EMAIL", label: "E-mail transacional", providers: ["simulated", "smtp"] },
  { kind: "CALENDAR", label: "Calendário (Google/Microsoft)", providers: ["simulated"] },
  { kind: "TEAMS", label: "Microsoft Teams (notificações)", providers: ["simulated"] },
  { kind: "ESIGN", label: "Assinatura eletrônica", providers: ["manual"] },
  { kind: "NFSE", label: "NFS-e (provedor fiscal)", providers: ["simulated"] },
  { kind: "BANK", label: "Bancos e cobrança", providers: ["statement-import"] },
  { kind: "ACCOUNTING", label: "Contabilidade", providers: ["csv-export"] },
  { kind: "TICKETING", label: "Ferramenta de chamados externa", providers: ["simulated"] },
  { kind: "API", label: "API externa (chaves)", providers: ["api-keys"] },
];
export const integrationSchema = z.object({ kind: z.string(), provider: z.string(), environment: z.enum(["SANDBOX", "PRODUCTION"]), enabled: z.preprocess((v) => v === "on", z.boolean()), secretRef: z.string().optional() });
export async function saveIntegration(ctx: Ctx, i: z.infer<typeof integrationSchema>) {
  requireWritable(ctx);
  guard(ctx);
  const def = INTEGRATION_KINDS.find((k) => k.kind === i.kind);
  if (!def || !def.providers.includes(i.provider)) throw validation("Provedor não suportado para esta integração.");
  if (i.secretRef && !/^[A-Z][A-Z0-9_]{2,60}$/.test(i.secretRef)) throw validation("Informe apenas o NOME da variável/segredo (ex.: NFSE_API_KEY), nunca o valor.");
  await ctx.db.integrationConfig.upsert({
    where: { organizationId_kind: { organizationId: ctx.orgId, kind: i.kind } },
    create: { organizationId: ctx.orgId, kind: i.kind, provider: i.provider, environment: i.environment, enabled: i.enabled, secretRef: i.secretRef || null },
    update: { provider: i.provider, environment: i.environment, enabled: i.enabled, secretRef: i.secretRef || null },
  });
  await audit(ctx, { action: "integration.update", entity: "IntegrationConfig", changes: { kind: i.kind, provider: i.provider, environment: i.environment, enabled: i.enabled } });
}
