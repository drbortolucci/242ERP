/**
 * Worker de tarefas em segundo plano: `npm run worker`.
 * Também agenda tarefas periódicas (SLA, recorrências, política de inadimplência) de forma idempotente.
 */
import { drain, enqueue } from "./queue";
import "./handlers";
import { logger } from "../logger";

async function schedulePeriodic() {
  const now = new Date();
  const fiveMin = new Date(Math.floor(now.getTime() / 300000) * 300000).toISOString();
  const day = now.toISOString().slice(0, 10);
  await enqueue("ams.sla_check", {}, { uniqueKey: `sla:${fiveMin}` });
  await enqueue("finance.recurring_payables", {}, { uniqueKey: `recurring:${day}` });
  await enqueue("ams.hour_bank_expiry", {}, { uniqueKey: `hourbank:${day}` });
  await enqueue("saas.billing_policy", {}, { uniqueKey: `saas-policy:${day}` });
  await enqueue("contracts.alerts", {}, { uniqueKey: `contract-alerts:${day}` });
}

async function loop() {
  logger.info("worker.start", {});
  for (;;) {
    try {
      await schedulePeriodic();
      const n = await drain(100);
      if (n === 0) await new Promise((r) => setTimeout(r, 5000));
    } catch (e) {
      logger.error("worker.loop", { error: e as Error });
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
}

if (process.argv[1]?.includes("worker")) void loop();
