import { z } from "zod";
import { requirePerm, requireWritable, can, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { getSetting } from "@/server/settings";
import { notFound, rule, validation, AppError } from "@/lib/errors";
import { zDate, zDecimal, zOptId, zOptStr, zArray } from "@/lib/zod-helpers";
import { addDays, civil, eachDay, toCivil, type CivilDate } from "@/lib/dates";
import { dec, qty, sum } from "@/lib/money";
import { allocationByDay, allocationTotalHours, findConflicts, dayCapacity, type AllocationSpec, type CalendarSpec, type ProfessionalSpec } from "@/domain/capacity";

type Db = Ctx["db"];

/** Calendário + capacidade + ausências do profissional, no formato do domínio. */
export async function loadSpecs(db: Db, professionalId: string, from: CivilDate, to: CivilDate) {
  const prof = await db.professional.findFirst({ where: { id: professionalId } });
  if (!prof) throw notFound("Profissional");
  const cal = prof.calendarId ? await db.workCalendar.findFirst({ where: { id: prof.calendarId } }) : await db.workCalendar.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } });
  const holidays = cal ? await db.holiday.findMany({ where: { calendarId: cal.id, date: { gte: civil(from), lte: civil(to) } } }) : [];
  const absences = await db.absence.findMany({ where: { professionalId, startDate: { lte: civil(to) }, endDate: { gte: civil(from) } } });
  const calendar: CalendarSpec = { weeklyHours: cal?.weeklyHours.map((h) => h.toString()) ?? ["0", "8", "8", "8", "8", "8", "0"], holidays: new Set(holidays.map((h) => toCivil(h.date))) };
  const profSpec: ProfessionalSpec = { capacityPct: prof.capacityPct.toString(), absences: absences.map((a) => ({ start: toCivil(a.startDate), end: toCivil(a.endDate) })) };
  return { prof, calendar, profSpec };
}

const toSpec = (a: { id: string; startDate: Date; endDate: Date; mode: string; value: unknown }): AllocationSpec => ({ id: a.id, start: toCivil(a.startDate), end: toCivil(a.endDate), mode: a.mode as AllocationSpec["mode"], value: String(a.value) });

export const allocationSchema = z.object({
  professionalId: z.string().min(1), projectId: zOptId, contractId: zOptId, requestId: zOptId, startDate: zDate, endDate: zDate,
  mode: z.enum(["PERCENT", "HOURS_PER_DAY", "TOTAL_HOURS"]), value: zDecimal, status: z.enum(["TENTATIVE", "CONFIRMED"]).default("TENTATIVE"),
  billable: z.preprocess((v) => v === undefined ? true : v === "on" || v === true || v === "true", z.boolean()), overrideReason: zOptStr,
});
export type AllocationInput = z.infer<typeof allocationSchema>;

/** Simula a alocação: total em horas e conflitos (sem gravar). */
export async function previewAllocation(ctx: Ctx, i: AllocationInput, exceptId?: string) {
  if (i.endDate < i.startDate) throw validation("Período inválido.");
  const v = dec(i.value);
  if (v.lte(0)) throw validation("Informe um valor maior que zero.");
  if (i.mode === "PERCENT" && v.gt(100)) throw validation("Percentual acima de 100%.");
  if (i.mode === "HOURS_PER_DAY" && v.gt(24)) throw validation("Horas por dia acima de 24.");
  const { calendar, profSpec } = await loadSpecs(ctx.db, i.professionalId, i.startDate, i.endDate);
  const others = await ctx.db.allocation.findMany({ where: { professionalId: i.professionalId, status: { in: ["TENTATIVE", "CONFIRMED"] }, startDate: { lte: civil(i.endDate) }, endDate: { gte: civil(i.startDate) }, ...(exceptId ? { NOT: { id: exceptId } } : {}) } });
  const spec: AllocationSpec = { start: i.startDate, end: i.endDate, mode: i.mode, value: i.value };
  const tolerance = (await getSetting(ctx, "allocation")).overallocationTolerancePct;
  const conflicts = findConflicts([...others.map(toSpec), spec], calendar, profSpec, tolerance, { start: i.startDate, end: i.endDate });
  return { totalHours: allocationTotalHours(spec, calendar, profSpec), conflicts, others };
}

/**
 * Cria alocação. Conflitos geram alerta; confirmar com conflito exige permissão resource.override + justificativa.
 */
export async function createAllocation(ctx: Ctx, i: AllocationInput) {
  requirePerm(ctx, "resource.write");
  requireWritable(ctx);
  if (!i.projectId && !i.contractId) throw validation("Vincule a um projeto ou contrato.");
  const prof = await ctx.db.professional.findFirst({ where: { id: i.professionalId, active: true } });
  if (!prof) throw validation("Profissional inválido ou inativo.");
  let companyId = prof.companyId;
  if (i.projectId) {
    const p = await ctx.db.project.findFirst({ where: { id: i.projectId } });
    if (!p) throw validation("Projeto inválido.");
    companyId = p.companyId;
  }
  const pv = await previewAllocation(ctx, i);
  if (pv.conflicts.length && i.status === "CONFIRMED") {
    if (!can(ctx, "resource.override")) throw new AppError("BUSINESS_RULE", `Conflito de alocação em ${pv.conflicts.length} dia(s) (ex.: ${pv.conflicts[0].day}: ${pv.conflicts[0].allocated}h alocadas para ${pv.conflicts[0].capacity}h de capacidade). Salve como provisória ou peça autorização ao gestor de recursos.`, { conflicts: pv.conflicts.length });
    if (!i.overrideReason?.trim()) throw validation("Confirmar alocação com conflito exige justificativa.");
  }
  const a = await ctx.db.allocation.create({
    data: {
      organizationId: ctx.orgId, companyId, professionalId: i.professionalId, projectId: i.projectId ?? null, contractId: i.contractId ?? null, requestId: i.requestId ?? null,
      startDate: civil(i.startDate), endDate: civil(i.endDate), mode: i.mode, value: dec(i.value), totalHours: pv.totalHours, status: i.status, billable: i.billable,
      overrideReason: pv.conflicts.length && i.status === "CONFIRMED" ? i.overrideReason ?? null : null, overrideById: pv.conflicts.length && i.status === "CONFIRMED" ? ctx.userId : null, createdById: ctx.userId,
    },
  });
  if (i.projectId && !(await ctx.db.projectMember.findFirst({ where: { projectId: i.projectId, professionalId: i.professionalId } }))) {
    await ctx.db.projectMember.create({ data: { organizationId: ctx.orgId, projectId: i.projectId, professionalId: i.professionalId, teamRoleId: prof.teamRoleId } });
  }
  if (i.requestId) await ctx.db.resourceRequest.update({ where: { id: i.requestId }, data: { status: "FULFILLED" } });
  await audit(ctx, { action: pv.conflicts.length && i.status === "CONFIRMED" ? "allocation.create_override" : "allocation.create", entity: "Allocation", entityId: a.id, companyId, reason: a.overrideReason, changes: { professional: prof.name, hours: pv.totalHours.toString(), conflicts: pv.conflicts.length, status: i.status } });
  return { allocation: a, conflicts: pv.conflicts };
}

export async function confirmAllocation(ctx: Ctx, id: string, overrideReason?: string) {
  requirePerm(ctx, "resource.write");
  requireWritable(ctx);
  const a = await ctx.db.allocation.findFirst({ where: { id } });
  if (!a) throw notFound("Alocação");
  if (a.status !== "TENTATIVE") throw rule("Somente reservas provisórias podem ser confirmadas.");
  const pv = await previewAllocation(ctx, { professionalId: a.professionalId, startDate: toCivil(a.startDate), endDate: toCivil(a.endDate), mode: a.mode as AllocationInput["mode"], value: a.value.toString(), status: "CONFIRMED", billable: a.billable }, a.id);
  if (pv.conflicts.length) {
    if (!can(ctx, "resource.override")) throw rule(`Conflito em ${pv.conflicts.length} dia(s). Exige autorização do gestor de recursos.`);
    if (!overrideReason?.trim()) throw validation("Justifique a confirmação com conflito.");
  }
  await ctx.db.allocation.update({ where: { id }, data: { status: "CONFIRMED", overrideReason: pv.conflicts.length ? overrideReason ?? null : null, overrideById: pv.conflicts.length ? ctx.userId : null } });
  await audit(ctx, { action: pv.conflicts.length ? "allocation.confirm_override" : "allocation.confirm", entity: "Allocation", entityId: id, reason: overrideReason ?? null, changes: { conflicts: pv.conflicts.length } });
}

export async function cancelAllocation(ctx: Ctx, id: string) {
  requireWritable(ctx);
  requirePerm(ctx, "resource.write");
  await ctx.db.allocation.update({ where: { id }, data: { status: "CANCELED" } });
  await audit(ctx, { action: "allocation.cancel", entity: "Allocation", entityId: id });
}

export const requestSchema = z.object({ projectId: z.string(), teamRoleId: zOptId, seniorityId: zOptId, skillIds: zArray, hours: zDecimal, startDate: zDate, endDate: zDate, notes: zOptStr });
export async function createResourceRequest(ctx: Ctx, i: z.infer<typeof requestSchema>) {
  if (!can(ctx, "project.write") && !can(ctx, "resource.write")) requirePerm(ctx, "project.write");
  requireWritable(ctx);
  const r = await ctx.db.resourceRequest.create({ data: { organizationId: ctx.orgId, projectId: i.projectId, teamRoleId: i.teamRoleId ?? null, seniorityId: i.seniorityId ?? null, skillIds: i.skillIds, hours: qty(i.hours), startDate: civil(i.startDate), endDate: civil(i.endDate), notes: i.notes ?? null, requestedById: ctx.userId } });
  await audit(ctx, { action: "resource_request.create", entity: "Project", entityId: i.projectId, changes: { hours: i.hours } });
  return r;
}

/** Profissionais compatíveis com a solicitação, ordenados por disponibilidade em horas no período. */
export async function suggestProfessionals(ctx: Ctx, requestId: string) {
  const r = await ctx.db.resourceRequest.findFirst({ where: { id: requestId } });
  if (!r) throw notFound("Solicitação");
  const profs = await ctx.db.professional.findMany({ where: { active: true, ...(r.teamRoleId ? { teamRoleId: r.teamRoleId } : {}), ...(r.seniorityId ? { seniorityId: r.seniorityId } : {}) } });
  const out = [];
  for (const p of profs) {
    if (r.skillIds.length) {
      const sk = await ctx.db.professionalSkill.findMany({ where: { professionalId: p.id } });
      if (!r.skillIds.every((s) => sk.some((x) => x.skillId === s))) continue;
    }
    const g = await capacityGrid(ctx, [p.id], toCivil(r.startDate), toCivil(r.endDate));
    const row = g.rows[0];
    out.push({ professional: p, capacity: row.capacity, allocated: row.allocated, free: qty(row.capacity.minus(row.allocated)) });
  }
  return out.sort((a, b) => b.free.comparedTo(a.free));
}

/**
 * Grade de capacidade x alocado x apontado x faturável por profissional no período (horas).
 * Capacidade e alocação são sempre convertidas em horas pelo calendário de cada profissional.
 */
export async function capacityGrid(ctx: Ctx, professionalIds: string[] | null, from: CivilDate, to: CivilDate, bucket: "week" | "month" | "total" = "total") {
  const profs = await ctx.db.professional.findMany({ where: { active: true, ...(professionalIds ? { id: { in: professionalIds } } : {}) }, orderBy: { name: "asc" } });
  const allocs = await ctx.db.allocation.findMany({ where: { professionalId: { in: profs.map((p) => p.id) }, status: { in: ["TENTATIVE", "CONFIRMED"] }, startDate: { lte: civil(to) }, endDate: { gte: civil(from) } } });
  const entries = await ctx.db.timeEntry.findMany({ where: { professionalId: { in: profs.map((p) => p.id) }, date: { gte: civil(from), lte: civil(to) }, status: { not: "REJECTED" } } });
  const bucketOf = (d: CivilDate) => (bucket === "month" ? d.slice(0, 7) : bucket === "week" ? weekStart(d) : "total");
  const rows = [];
  for (const p of profs) {
    const { calendar, profSpec } = await loadSpecs(ctx.db, p.id, from, to);
    const cap = new Map<string, ReturnType<typeof dec>>();
    const alc = new Map<string, ReturnType<typeof dec>>();
    const tent = new Map<string, ReturnType<typeof dec>>();
    for (const d of eachDay(from, to)) cap.set(bucketOf(d), (cap.get(bucketOf(d)) ?? dec(0)).plus(dayCapacity(d, calendar, profSpec)));
    for (const a of allocs.filter((x) => x.professionalId === p.id)) {
      for (const [d, h] of allocationByDay(toSpec(a), calendar, profSpec)) {
        if (d < from || d > to) continue;
        const target = a.status === "CONFIRMED" ? alc : tent;
        target.set(bucketOf(d), (target.get(bucketOf(d)) ?? dec(0)).plus(h));
      }
    }
    const mine = entries.filter((e) => e.professionalId === p.id);
    const logged = new Map<string, ReturnType<typeof dec>>();
    const billable = new Map<string, ReturnType<typeof dec>>();
    for (const e of mine) {
      const b = bucketOf(toCivil(e.date));
      logged.set(b, (logged.get(b) ?? dec(0)).plus(dec(e.hours)));
      if (e.billable) billable.set(b, (billable.get(b) ?? dec(0)).plus(dec(e.hours)));
    }
    const buckets = [...cap.keys()];
    const capacity = qty(sum([...cap.values()]));
    const allocated = qty(sum([...alc.values()]).plus(sum([...tent.values()])));
    rows.push({
      professional: p, capacity, allocated, confirmed: qty(sum([...alc.values()])), tentative: qty(sum([...tent.values()])),
      logged: qty(sum([...logged.values()])), billable: qty(sum([...billable.values()])),
      buckets: buckets.map((k) => ({ key: k, capacity: qty(cap.get(k) ?? 0), allocated: qty((alc.get(k) ?? dec(0)).plus(tent.get(k) ?? 0)), logged: qty(logged.get(k) ?? 0), billable: qty(billable.get(k) ?? 0) })),
      utilizationPct: capacity.isZero() ? null : qty(sum([...billable.values()]).div(capacity).times(100)),
    });
  }
  return { rows, from, to };
}

export function weekStart(d: CivilDate) {
  const wd = civil(d).getUTCDay();
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}
