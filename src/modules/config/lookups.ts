import type { Ctx } from "@/server/context";

export type Opt = { value: string; label: string };

/** Listas de opções para formulários (sempre escopadas pelo tenant). */
export const lookups = {
  companies: async (ctx: Ctx): Promise<Opt[]> => (await ctx.db.company.findMany({ where: { active: true }, orderBy: { legalName: "asc" } })).map((c) => ({ value: c.id, label: c.tradeName || c.legalName })),
  teamRoles: async (ctx: Ctx): Promise<Opt[]> => (await ctx.db.teamRole.findMany({ where: { active: true }, orderBy: { name: "asc" } })).map((c) => ({ value: c.id, label: c.name })),
  seniorities: async (ctx: Ctx): Promise<Opt[]> => (await ctx.db.seniorityLevel.findMany({ orderBy: { order: "asc" } })).map((c) => ({ value: c.id, label: c.name })),
  calendars: async (ctx: Ctx): Promise<Opt[]> => (await ctx.db.workCalendar.findMany({ where: { active: true } })).map((c) => ({ value: c.id, label: c.name })),
  costCenters: async (ctx: Ctx): Promise<Opt[]> => (await ctx.db.costCenter.findMany({ where: { active: true }, orderBy: { code: "asc" } })).map((c) => ({ value: c.id, label: `${c.code} ${c.name}` })),
  businessUnits: async (ctx: Ctx): Promise<Opt[]> => (await ctx.db.businessUnit.findMany({ where: { active: true } })).map((c) => ({ value: c.id, label: c.name })),
  skills: async (ctx: Ctx): Promise<Opt[]> => (await ctx.db.skill.findMany({ where: { active: true }, orderBy: { name: "asc" } })).map((c) => ({ value: c.id, label: c.name })),
  services: async (ctx: Ctx): Promise<Opt[]> => (await ctx.db.service.findMany({ where: { active: true }, orderBy: { code: "asc" } })).map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
  suppliers: async (ctx: Ctx): Promise<Opt[]> => (await ctx.db.party.findMany({ where: { isSupplier: true, active: true }, orderBy: { name: "asc" } })).map((c) => ({ value: c.id, label: c.tradeName || c.name })),
  customers: async (ctx: Ctx): Promise<Opt[]> => (await ctx.db.party.findMany({ where: { OR: [{ isCustomer: true }, { isProspect: true }], active: true }, orderBy: { name: "asc" } })).map((c) => ({ value: c.id, label: c.tradeName || c.name })),
  partners: async (ctx: Ctx): Promise<Opt[]> => (await ctx.db.party.findMany({ where: { isPartner: true, active: true }, orderBy: { name: "asc" } })).map((c) => ({ value: c.id, label: c.tradeName || c.name })),
  professionals: async (ctx: Ctx): Promise<Opt[]> => (await ctx.db.professional.findMany({ where: { active: true }, orderBy: { name: "asc" } })).map((c) => ({ value: c.id, label: c.name })),
  paymentTerms: async (ctx: Ctx): Promise<Opt[]> => (await ctx.db.paymentTerm.findMany({ where: { active: true } })).map((c) => ({ value: c.id, label: c.name })),
  projectTypes: async (ctx: Ctx): Promise<Opt[]> => (await ctx.db.projectType.findMany({ where: { active: true } })).map((c) => ({ value: c.id, label: c.name })),
  stages: async (ctx: Ctx): Promise<Opt[]> => (await ctx.db.pipelineStage.findMany({ where: { active: true }, orderBy: { order: "asc" } })).map((c) => ({ value: c.id, label: c.name })),
  lossReasons: async (ctx: Ctx): Promise<Opt[]> => (await ctx.db.lossReason.findMany({ where: { active: true } })).map((c) => ({ value: c.id, label: c.name })),
  expenseCategories: async (ctx: Ctx): Promise<Opt[]> => (await ctx.db.expenseCategory.findMany({ where: { active: true } })).map((c) => ({ value: c.id, label: c.name })),
  accounts: async (ctx: Ctx): Promise<Opt[]> => (await ctx.db.managerialAccount.findMany({ where: { active: true }, orderBy: { code: "asc" } })).map((c) => ({ value: c.id, label: `${c.code} ${c.name}` })),
  bankAccounts: async (ctx: Ctx): Promise<Opt[]> => (await ctx.db.bankAccount.findMany({ where: { active: true } })).map((c) => ({ value: c.id, label: c.name })),
  slaPolicies: async (ctx: Ctx): Promise<Opt[]> => (await ctx.db.slaPolicy.findMany({ where: { active: true } })).map((c) => ({ value: c.id, label: c.name })),
  users: async (ctx: Ctx): Promise<Opt[]> => {
    const { prisma } = await import("@/server/db");
    const ms = await ctx.db.membership.findMany({ where: { kind: "INTERNAL", active: true } });
    return (await prisma.user.findMany({ where: { id: { in: ms.map((m) => m.userId) } }, orderBy: { name: "asc" } })).map((u) => ({ value: u.id, label: u.name }));
  },
};

/** Mapa id → rótulo para hidratar listas (evita N+1). */
export async function nameMap(ctx: Ctx, model: "party" | "professional" | "project" | "contract" | "company" | "service" | "costCenter" | "managerialAccount" | "teamRole" | "seniorityLevel" | "expenseCategory" | "pipelineStage", ids: (string | null | undefined)[]) {
  const uniq = [...new Set(ids.filter(Boolean))] as string[];
  if (!uniq.length) return new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = await (ctx.db as any)[model].findMany({ where: { id: { in: uniq } } });
  return new Map<string, string>(rows.map((r) => [r.id, r.tradeName || r.name || r.legalName || r.title || r.code || r.number]));
}

export async function userNameMap(ids: (string | null | undefined)[]) {
  const { prisma } = await import("@/server/db");
  const uniq = [...new Set(ids.filter(Boolean))] as string[];
  if (!uniq.length) return new Map<string, string>();
  return new Map((await prisma.user.findMany({ where: { id: { in: uniq } } })).map((u) => [u.id, u.name]));
}
