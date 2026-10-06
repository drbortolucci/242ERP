import { z } from "zod";
import { requirePerm, requireWritable, requireAnyPerm, can, type Ctx } from "@/server/context";
import { audit, diff } from "@/server/audit";
import { conflict, notFound, validation, forbidden } from "@/lib/errors";
import { zArray, zDate, zDecimal, zEmail, zOptId, zOptStr, zStr } from "@/lib/zod-helpers";
import { addDays, civil, toCivil, type CivilDate } from "@/lib/dates";
import { dec, rate } from "@/lib/money";
import { textSearch, type PageQuery } from "@/lib/query";

export const professionalSchema = z.object({
  companyId: z.string().min(1, "Selecione a empresa"),
  name: zStr(2, "Informe o nome"),
  email: zEmail,
  employmentType: z.enum(["CLT", "PJ", "PARTNER", "OTHER"]),
  supplierPartyId: zOptId,
  teamRoleId: zOptId,
  seniorityId: zOptId,
  managerId: zOptId,
  calendarId: zOptId,
  costCenterId: zOptId,
  businessUnitId: zOptId,
  capacityPct: zDecimal,
  certifications: z.preprocess((v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : v ?? []), z.array(z.string())),
  skillIds: zArray,
});
export type ProfessionalInput = z.infer<typeof professionalSchema>;

async function validateRefs(ctx: Ctx, i: ProfessionalInput) {
  if (!(await ctx.db.company.findFirst({ where: { id: i.companyId } }))) throw validation("Empresa inválida.");
  if ((i.employmentType === "PJ" || i.employmentType === "PARTNER") && i.supplierPartyId) {
    const s = await ctx.db.party.findFirst({ where: { id: i.supplierPartyId, isSupplier: true } });
    if (!s) throw validation("Fornecedor (pessoa jurídica que fatura) inválido.");
  }
  const cap = dec(i.capacityPct);
  if (cap.lte(0) || cap.gt(100)) throw validation("Capacidade deve estar entre 0 e 100%.");
}

function toData(i: ProfessionalInput) {
  return {
    companyId: i.companyId, name: i.name, email: i.email ?? null, employmentType: i.employmentType, supplierPartyId: i.supplierPartyId ?? null,
    teamRoleId: i.teamRoleId ?? null, seniorityId: i.seniorityId ?? null, managerId: i.managerId ?? null, calendarId: i.calendarId ?? null,
    costCenterId: i.costCenterId ?? null, businessUnitId: i.businessUnitId ?? null, capacityPct: i.capacityPct, certifications: i.certifications,
  };
}

async function setSkills(ctx: Ctx, professionalId: string, skillIds: string[]) {
  await ctx.db.professionalSkill.deleteMany({ where: { professionalId } });
  if (skillIds.length) await ctx.db.professionalSkill.createMany({ data: skillIds.map((skillId) => ({ organizationId: ctx.orgId, professionalId, skillId })) });
}

export async function createProfessional(ctx: Ctx, i: ProfessionalInput) {
  requireAnyPerm(ctx, "master.write", "resource.write");
  requireWritable(ctx);
  await validateRefs(ctx, i);
  if (i.email && (await ctx.db.professional.findFirst({ where: { email: i.email } }))) throw conflict("Já existe profissional com este e-mail.");
  const p = await ctx.db.professional.create({ data: { organizationId: ctx.orgId, ...toData(i) } });
  await setSkills(ctx, p.id, i.skillIds);
  // Vincula usuário existente com o mesmo e-mail (portal do consultor)
  if (p.email) await linkUserByEmail(ctx, p.id, p.email);
  await audit(ctx, { action: "professional.create", entity: "Professional", entityId: p.id, companyId: p.companyId, changes: { name: p.name, employmentType: p.employmentType } });
  return p;
}

export async function updateProfessional(ctx: Ctx, id: string, i: ProfessionalInput) {
  requireAnyPerm(ctx, "master.write", "resource.write");
  requireWritable(ctx);
  const before = await ctx.db.professional.findFirst({ where: { id } });
  if (!before) throw notFound("Profissional");
  await validateRefs(ctx, i);
  if (i.managerId === id) throw validation("O profissional não pode ser gestor de si mesmo.");
  const after = await ctx.db.professional.update({ where: { id }, data: toData(i) });
  await setSkills(ctx, id, i.skillIds);
  if (after.email) await linkUserByEmail(ctx, id, after.email);
  await audit(ctx, { action: "professional.update", entity: "Professional", entityId: id, companyId: after.companyId, changes: diff(before, after) });
  return after;
}

async function linkUserByEmail(ctx: Ctx, professionalId: string, email: string) {
  const memberships = await ctx.db.membership.findMany({ where: { kind: "INTERNAL" } });
  for (const m of memberships) {
    if (m.professionalId) continue;
    const { prisma } = await import("@/server/db");
    const u = await prisma.user.findUnique({ where: { id: m.userId } });
    if (u?.email === email) {
      await ctx.db.membership.update({ where: { id: m.id }, data: { professionalId } });
      await ctx.db.professional.update({ where: { id: professionalId }, data: { userId: u.id } });
    }
  }
}

export async function setProfessionalActive(ctx: Ctx, id: string, active: boolean) {
  requireAnyPerm(ctx, "master.write", "resource.write");
  requireWritable(ctx);
  if (!(await ctx.db.professional.findFirst({ where: { id } }))) throw notFound("Profissional");
  await ctx.db.professional.update({ where: { id }, data: { active } });
  await audit(ctx, { action: active ? "professional.activate" : "professional.deactivate", entity: "Professional", entityId: id });
}

// ------------------------------------------------------------------ Custo/hora com vigência (sigiloso)

export const costRateSchema = z.object({ professionalId: z.string(), hourlyCost: zDecimal, validFrom: zDate });

/**
 * Registra novo custo/hora a partir de uma data. A vigência anterior em aberto é encerrada no dia anterior.
 * Não permite inserir vigência anterior a uma já existente (preserva custos históricos aplicados).
 */
export async function addCostRate(ctx: Ctx, i: z.infer<typeof costRateSchema>) {
  requirePerm(ctx, "cost.manage");
  requireWritable(ctx);
  if (dec(i.hourlyCost).lte(0)) throw validation("Custo/hora deve ser maior que zero.");
  if (!(await ctx.db.professional.findFirst({ where: { id: i.professionalId } }))) throw notFound("Profissional");
  return ctx.db.$transaction(async (tx) => {
    const later = await tx.costRate.findFirst({ where: { professionalId: i.professionalId, validFrom: { gte: civil(i.validFrom) } } });
    if (later) throw validation(`Já existe custo vigente a partir de ${toCivil(later.validFrom)}. Informe uma data posterior.`);
    const open = await tx.costRate.findFirst({ where: { professionalId: i.professionalId, validTo: null } });
    if (open) await tx.costRate.update({ where: { id: open.id }, data: { validTo: civil(addDays(i.validFrom, -1)) } });
    const r = await tx.costRate.create({ data: { organizationId: ctx.orgId, professionalId: i.professionalId, hourlyCost: rate(i.hourlyCost), validFrom: civil(i.validFrom), createdById: ctx.userId } });
    await audit(ctx, { action: "cost_rate.create", entity: "Professional", entityId: i.professionalId, changes: { hourlyCost: i.hourlyCost, validFrom: i.validFrom, previousClosed: open?.id ?? null } }, tx);
    return r;
  });
}

type RateReader = { costRate: { findFirst: (a: object) => Promise<{ hourlyCost: unknown; validFrom: Date } | null> } };
/** Custo/hora vigente na data (usado em apontamentos — gera snapshot no registro). */
export async function costRateAt(db: RateReader, professionalId: string, date: CivilDate) {
  const d = civil(date);
  const r = await db.costRate.findFirst({ where: { professionalId, validFrom: { lte: d }, OR: [{ validTo: null }, { validTo: { gte: d } }] }, orderBy: { validFrom: "desc" } } as object);
  return r ? dec(r.hourlyCost as string) : null;
}

export async function listCostRates(ctx: Ctx, professionalId: string) {
  if (!can(ctx, "cost.view")) throw forbidden("Custos são restritos.");
  return ctx.db.costRate.findMany({ where: { professionalId }, orderBy: { validFrom: "desc" } });
}

// ------------------------------------------------------------------ Ausências

export const absenceSchema = z.object({ professionalId: z.string(), type: z.enum(["VACATION", "SICK", "LEAVE", "TRAINING", "OTHER"]), startDate: zDate, endDate: zDate, notes: zOptStr });
export async function addAbsence(ctx: Ctx, i: z.infer<typeof absenceSchema>) {
  requireAnyPerm(ctx, "resource.write", "master.write");
  requireWritable(ctx);
  if (i.endDate < i.startDate) throw validation("Data final anterior à inicial.");
  const overlap = await ctx.db.absence.findFirst({ where: { professionalId: i.professionalId, startDate: { lte: civil(i.endDate) }, endDate: { gte: civil(i.startDate) } } });
  if (overlap) throw conflict("Já existe ausência no período.");
  const a = await ctx.db.absence.create({ data: { organizationId: ctx.orgId, professionalId: i.professionalId, type: i.type, startDate: civil(i.startDate), endDate: civil(i.endDate), notes: i.notes ?? null } });
  await audit(ctx, { action: "absence.create", entity: "Professional", entityId: i.professionalId, changes: { type: i.type, startDate: i.startDate, endDate: i.endDate } });
  return a;
}

export async function listProfessionals(ctx: Ctx, q: PageQuery, f: { active?: string; employmentType?: string; seniorityId?: string; skillId?: string } = {}) {
  requireAnyPerm(ctx, "master.read", "resource.read");
  let idsBySkill: string[] | undefined;
  if (f.skillId) idsBySkill = (await ctx.db.professionalSkill.findMany({ where: { skillId: f.skillId } })).map((s) => s.professionalId);
  const where = {
    AND: [textSearch(q.q, ["name", "email"]), f.active === "inactive" ? { active: false } : f.active === "all" ? {} : { active: true },
      f.employmentType ? { employmentType: f.employmentType } : {}, f.seniorityId ? { seniorityId: f.seniorityId } : {}, idsBySkill ? { id: { in: idsBySkill } } : {}],
  };
  const [rows, total] = await Promise.all([ctx.db.professional.findMany({ where, orderBy: { name: "asc" }, skip: q.skip, take: q.take }), ctx.db.professional.count({ where })]);
  return { rows, total };
}

export async function professionalOptions(ctx: Ctx) {
  const rows = await ctx.db.professional.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return rows.map((p) => ({ value: p.id, label: p.name }));
}
