/** Sincronização diária do razão gerencial (mês corrente e anterior, se abertos) por empresa. */
import { registerJob } from "@/server/jobs/queue";
import { prisma } from "@/server/db";
import { systemCtx } from "@/server/context";
import { isPeriodOpen } from "@/server/periods";
import { addMonths, monthStart, todayIn } from "@/lib/dates";
import { syncLedger } from "./ledger";

registerJob("controlling.ledger_sync", async () => {
  const companies = await prisma.company.findMany({ where: { active: true }, select: { id: true, organizationId: true } });
  let n = 0;
  for (const c of companies) {
    const ctx = await systemCtx(c.organizationId, ["controlling.write", "controlling.read"]);
    if (ctx.readOnly || !ctx.planModules.includes("controlling")) continue;
    const cur = monthStart(todayIn(ctx.timezone));
    for (const m of [addMonths(cur, -1), cur]) if (await isPeriodOpen(ctx.db, c.id, m)) n += (await syncLedger(ctx, c.id, m)).posted;
  }
  return { posted: n };
});
