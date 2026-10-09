/**
 * Setor de atividade da organização: aplica o perfil (itens de partida editáveis) e resolve a terminologia exibida.
 * Aplicar um perfil só ACRESCENTA o que falta (por nome ou código) — nunca altera nem remove cadastros existentes.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { requirePerm, requireWritable, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { getSetting } from "@/server/settings";
import { validation } from "@/lib/errors";
import { SECTOR_PROFILES, TERM_KEYS, resolveTerms, sectorProfile, type TermKey, type Terms } from "@/domain/sectors";
import { parseWbsText } from "@/domain/wbs-templates";

type Tx = Prisma.TransactionClient;

export interface SectorItemsResult { projectTypes: number; teamRoles: number; services: number; expenseCategories: number; skills: number }

/** Acrescenta à organização os itens do perfil que ainda não existem (idempotente). */
export async function addSectorItems(tx: Tx, orgId: string, sectorKey: string): Promise<SectorItemsResult> {
  const p = sectorProfile(sectorKey);
  const out: SectorItemsResult = { projectTypes: 0, teamRoles: 0, services: 0, expenseCategories: 0, skills: 0 };
  const lower = (xs: { name: string }[]) => new Set(xs.map((x) => x.name.trim().toLowerCase()));

  const types = lower(await tx.projectType.findMany({ where: { organizationId: orgId }, select: { name: true } }));
  const newTypes = p.projectTypes.filter((t) => !types.has(t.name.toLowerCase()));
  if (newTypes.length) out.projectTypes = (await tx.projectType.createMany({ data: newTypes.map((t) => ({ organizationId: orgId, name: t.name, templateKey: t.templateKey })) })).count;

  const roles = lower(await tx.teamRole.findMany({ where: { organizationId: orgId }, select: { name: true } }));
  const newRoles = p.teamRoles.filter((r) => !roles.has(r.toLowerCase()));
  if (newRoles.length) out.teamRoles = (await tx.teamRole.createMany({ data: newRoles.map((name) => ({ organizationId: orgId, name })) })).count;

  const accounts = await tx.managerialAccount.findMany({ where: { organizationId: orgId, systemKey: { in: ["REVENUE_PROJECTS", "REVENUE_AMS", "REVENUE_ALLOCATION", "DIRECT_EXPENSES"] } }, select: { id: true, systemKey: true } });
  const acc = (k: string) => accounts.find((a) => a.systemKey === k)?.id ?? null;
  const codes = new Set((await tx.service.findMany({ where: { organizationId: orgId }, select: { code: true } })).map((s) => s.code.toUpperCase()));
  const services = lower(await tx.service.findMany({ where: { organizationId: orgId }, select: { name: true } }));
  const newServices = p.services.filter((s) => !codes.has(s.code.toUpperCase()) && !services.has(s.name.toLowerCase()));
  if (newServices.length) out.services = (await tx.service.createMany({ data: newServices.map((s) => ({ organizationId: orgId, code: s.code, name: s.name, category: s.category, defaultModel: s.defaultModel, revenueAccountId: acc(s.account) })) })).count;

  const cats = lower(await tx.expenseCategory.findMany({ where: { organizationId: orgId }, select: { name: true } }));
  const newCats = p.expenseCategories.filter((c) => !cats.has(c.name.toLowerCase()));
  if (newCats.length) out.expenseCategories = (await tx.expenseCategory.createMany({ data: newCats.map((c) => ({ organizationId: orgId, accountId: acc("DIRECT_EXPENSES"), ...c })) })).count;

  if (p.skills.length) out.skills = (await tx.skill.createMany({ data: p.skills.map((name) => ({ organizationId: orgId, name })), skipDuplicates: true })).count;
  return out;
}

export const sectorSchema = z.object({ sector: z.string().refine((s) => !!SECTOR_PROFILES[s], "Setor inválido.") });

/** Define o setor da organização e acrescenta os itens de partida que faltam. A terminologia passa a seguir o novo setor. */
export async function applySectorProfile(ctx: Ctx, sector: string) {
  requirePerm(ctx, "settings.manage");
  requireWritable(ctx);
  if (!SECTOR_PROFILES[sector]) throw validation("Setor inválido.");
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { sector: true } });
    await tx.organization.update({ where: { id: ctx.orgId }, data: { sector } });
    const added = await addSectorItems(tx, ctx.orgId, sector);
    await audit(ctx, { action: "org.sector_apply", entity: "Organization", entityId: ctx.orgId, changes: { from: org.sector, to: sector, added } }, tx);
    return added;
  });
}

/** Terminologia efetiva da organização. */
export async function getTerms(ctx: Pick<Ctx, "db" | "sector">): Promise<Terms> {
  return resolveTerms(ctx.sector, await getSetting(ctx, "terminology"));
}

export const termsSchema = z.object(Object.fromEntries(Object.keys(TERM_KEYS).map((k) => [k, z.string().trim().max(40).optional()])) as Record<TermKey, z.ZodOptional<z.ZodString>>);

/** Personaliza termos (vazio = usar o do setor). */
export async function saveTerms(ctx: Ctx, input: Partial<Record<TermKey, string>>) {
  requirePerm(ctx, "settings.manage");
  requireWritable(ctx);
  const clean = Object.fromEntries((Object.keys(TERM_KEYS) as TermKey[]).map((k) => [k, (input[k] ?? "").trim().slice(0, 40)]));
  const before = await getSetting(ctx, "terminology");
  // Grava o conjunto completo (vazios explícitos limpam personalizações anteriores)
  await ctx.db.orgSetting.upsert({
    where: { organizationId_key: { organizationId: ctx.orgId, key: "terminology" } },
    create: { organizationId: ctx.orgId, key: "terminology", value: clean },
    update: { value: clean },
  });
  await audit(ctx, { action: "settings.terminology", entity: "OrgSetting", entityId: "terminology", changes: { before, after: clean } });
  return resolveTerms(ctx.sector, clean);
}


/**
 * Modelo de WBS próprio de um tipo de projeto, em texto (uma linha por item: `Fase | Item | tipo | % | aceite`).
 * Texto vazio remove o modelo próprio e volta ao modelo da biblioteca.
 */
export async function saveProjectTypeTemplate(ctx: Ctx, projectTypeId: string, text: string) {
  requirePerm(ctx, "settings.manage");
  requireWritable(ctx);
  const type = await ctx.db.projectType.findFirst({ where: { id: projectTypeId } });
  if (!type) throw validation("Tipo de projeto inválido.");
  if (!text.trim()) {
    await ctx.db.projectType.update({ where: { id: type.id }, data: { wbsTemplate: Prisma.DbNull } });
    await audit(ctx, { action: "project_type.template_reset", entity: "ProjectType", entityId: type.id });
    return null;
  }
  const { template, errors } = parseWbsText(text);
  if (errors.length) throw validation(errors.join(" "));
  await ctx.db.projectType.update({ where: { id: type.id }, data: { wbsTemplate: template as unknown as Prisma.InputJsonValue } });
  await audit(ctx, { action: "project_type.template_save", entity: "ProjectType", entityId: type.id, changes: { phases: template.length, items: template.reduce((n, p) => n + p.items.length, 0) } });
  return template;
}
