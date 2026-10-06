import type { Ctx } from "@/server/context";
import { lookups } from "@/modules/config/lookups";
export async function contractLookups(ctx: Ctx) {
  const [terms, sla, users, units, ccs, companies, customers] = await Promise.all([lookups.paymentTerms(ctx), lookups.slaPolicies(ctx), lookups.users(ctx), lookups.businessUnits(ctx), lookups.costCenters(ctx), lookups.companies(ctx), lookups.customers(ctx)]);
  return { terms, sla, users, units, ccs, companies, customers };
}
