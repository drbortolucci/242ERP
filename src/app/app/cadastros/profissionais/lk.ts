import type { Ctx } from "@/server/context";
import { lookups } from "@/modules/config/lookups";
import type { ProfLookups } from "./professional-form";

export async function profLookups(ctx: Ctx): Promise<ProfLookups> {
  const [companies, teamRoles, seniorities, calendars, costCenters, businessUnits, skills, suppliers, professionals] = await Promise.all([
    lookups.companies(ctx), lookups.teamRoles(ctx), lookups.seniorities(ctx), lookups.calendars(ctx), lookups.costCenters(ctx), lookups.businessUnits(ctx), lookups.skills(ctx), lookups.suppliers(ctx), lookups.professionals(ctx),
  ]);
  return { companies, teamRoles, seniorities, calendars, costCenters, businessUnits, skills, suppliers, professionals };
}
