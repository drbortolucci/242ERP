/** Tarefas periódicas do financeiro. */
import { registerJob } from "@/server/jobs/queue";
import { prisma } from "@/server/db";
import { systemCtx } from "@/server/context";
import { generateRecurringPayables } from "./service";

registerJob("finance.recurring_payables", async () => {
  const orgs = await prisma.recurringPayable.findMany({ where: { active: true }, distinct: ["organizationId"], select: { organizationId: true } });
  let n = 0;
  for (const o of orgs) {
    const ctx = await systemCtx(o.organizationId, ["finance.write"]);
    if (!ctx.readOnly) n += await generateRecurringPayables(ctx);
  }
  return { generated: n };
});
