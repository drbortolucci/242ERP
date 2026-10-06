import type { Ctx } from "@/server/context";
import { lookups } from "@/modules/config/lookups";

export async function crmLookups(ctx: Ctx) {
  const [companies, customers, stages, users, partners, services, lossReasons] = await Promise.all([lookups.companies(ctx), lookups.customers(ctx), lookups.stages(ctx), lookups.users(ctx), lookups.partners(ctx), lookups.services(ctx), lookups.lossReasons(ctx)]);
  const openStages = await ctx.db.pipelineStage.findMany({ where: { kind: "OPEN", active: true }, orderBy: { order: "asc" } });
  return { companies, customers, stages: openStages.map((s) => ({ value: s.id, label: s.name })), allStages: stages, users, partners, services, lossReasons };
}
