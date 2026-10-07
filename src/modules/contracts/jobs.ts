/** Alertas diários de contratos (vigência, saldo, limite de horas, OC): notificação interna ao responsável. */
import { registerJob } from "@/server/jobs/queue";
import { prisma } from "@/server/db";
import { systemCtx } from "@/server/context";
import { notify, usersWithPermission } from "@/server/notify";
import { contractAlerts } from "./service";

registerJob("contracts.alerts", async () => {
  const orgs = await prisma.contract.findMany({ where: { status: "ACTIVE" }, distinct: ["organizationId"], select: { organizationId: true } });
  let n = 0;
  for (const o of orgs) {
    const ctx = await systemCtx(o.organizationId, ["contract.read"]);
    const alerts = await contractAlerts(ctx);
    if (!alerts.length) continue;
    const owners = new Map((await prisma.contract.findMany({ where: { id: { in: alerts.map((a) => a.contractId) } }, select: { id: true, ownerUserId: true } })).map((c) => [c.id, c.ownerUserId]));
    const fallback = await usersWithPermission(o.organizationId, "contract.write");
    for (const a of alerts) {
      const owner = owners.get(a.contractId);
      await notify(o.organizationId, owner ? [owner] : fallback, { title: `Contrato ${a.number}: ${a.message}`, link: `/app/contratos/${a.contractId}` });
      n++;
    }
  }
  return { alerts: n };
});
