/** Tarefas periódicas do AMS (agendadas pelo worker de forma idempotente). */
import { registerJob } from "@/server/jobs/queue";
import { prisma } from "@/server/db";
import { systemCtx } from "@/server/context";
import { slaSweep } from "./tickets";
import { syncHourBank } from "./hour-bank";

registerJob("ams.sla_check", async () => slaSweep(new Date()));

/** Apuração diária do banco de horas: franquias do mês, consumo pendente e expiração de saldos vencidos. */
registerJob("ams.hour_bank_expiry", async () => {
  const contracts = await prisma.contract.findMany({ where: { commercialModel: "AMS_RECURRING", status: "ACTIVE" }, select: { id: true, organizationId: true } });
  let n = 0;
  for (const c of contracts) {
    const ctx = await systemCtx(c.organizationId, ["ams.manage"]);
    if (ctx.readOnly) continue;
    await syncHourBank(ctx, c.id);
    n++;
  }
  return { contracts: n };
});
