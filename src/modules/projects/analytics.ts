/**
 * Indicadores operacionais e econômicos do projeto (fontes operacionais).
 * O P&L oficial gerencial vem do razão gerencial (Etapa 7) — este painel usa os mesmos critérios.
 */
import type { Ctx } from "@/server/context";
import { civil, monthStart, toCivil, todayIn } from "@/lib/dates";
import { dec, money, pct, qty, sum } from "@/lib/money";
import { progressPct, evm, forecastAtCompletion, type ProgressMethod } from "@/domain/project-metrics";

export async function projectAnalytics(ctx: Ctx, projectId: string) {
  const p = await ctx.db.project.findFirst({ where: { id: projectId } });
  if (!p) return null;
  const today = todayIn(ctx.timezone);
  const [baselines, tasks, entries, expenses, pos, estimates, milestones, recognized] = await Promise.all([
    ctx.db.projectBaseline.findMany({ where: { projectId }, orderBy: { version: "asc" } }),
    ctx.db.projectTask.findMany({ where: { projectId } }),
    ctx.db.timeEntry.findMany({ where: { projectId, status: "APPROVED" } }),
    ctx.db.expense.findMany({ where: { projectId, status: "APPROVED" } }),
    ctx.db.purchaseOrder.findMany({ where: { projectId, status: { in: ["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"] } } }),
    ctx.db.projectEstimate.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 1 }),
    p.contractId ? ctx.db.contractMilestone.findMany({ where: { contractId: p.contractId, status: { not: "CANCELED" } } }) : [],
    ctx.db.managerialEntry.findMany({ where: { projectId, sourceType: "REVENUE_RECOGNITION" } }),
  ]);
  const original = baselines[0] ?? null;
  const current = baselines[baselines.length - 1] ?? null;
  // Pedidos de profissional PJ não entram como terceiros: o custo chega ao projeto pelas horas apontadas (evita duplicidade)
  const thirdPartyPos = pos.filter((x) => x.kind !== "PJ_PROFESSIONAL");
  const supplierInvoices = thirdPartyPos.length ? await ctx.db.supplierInvoice.findMany({ where: { purchaseOrderId: { in: thirdPartyPos.map((x) => x.id) }, status: "APPROVED" } }) : [];

  const actualHours = qty(sum(entries.map((e) => e.hours)));
  const laborCost = money(sum(entries.map((e) => e.costAmount ?? 0)));
  const thirdPartyCost = money(sum(supplierInvoices.map((i) => i.amount)));
  const expenseCost = money(sum(expenses.map((e) => e.amount)));
  const actualCost = money(sum([laborCost, thirdPartyCost, expenseCost]));
  // Comprometido não realizado = valor dos pedidos aprovados ainda não faturados pelo fornecedor
  // (pedido encerrado libera o saldo; saldo de cada pedido nunca é negativo)
  const committedNotRealized = money(sum(thirdPartyPos.filter((po) => po.status !== "CLOSED").map((po) => { const open = dec(po.totalAmount).minus(sum(supplierInvoices.filter((i) => i.purchaseOrderId === po.id).map((i) => i.amount))); return open.gt(0) ? open : 0; })));

  const workTasks = tasks.filter((t) => t.kind !== "PHASE");
  const progress = progressPct(p.progressMethod as ProgressMethod, {
    actualHours, plannedHours: current?.effortHours ?? 0,
    acceptedMilestones: sum(milestones.filter((m) => ["ACCEPTED", "BILLED"].includes(m.status)).map((m) => m.amount)), totalMilestones: sum(milestones.map((m) => m.amount)),
    doneWeight: sum(workTasks.filter((t) => t.status === "DONE").map((t) => t.weight)), totalWeight: sum(workTasks.map((t) => t.weight)),
    manual: p.manualProgressPct,
  });

  // PV: custo planejado acumulado até o mês corrente na linha de base vigente
  let pv = dec(0);
  if (current) {
    const months = await ctx.db.baselineMonth.findMany({ where: { baselineId: current.id, month: { lte: civil(monthStart(today)) } } });
    pv = sum(months.map((m) => dec(m.laborCost).plus(m.thirdPartyCost).plus(m.expenseCost)));
  }
  const bac = current ? money(sum([current.laborCost, current.thirdPartyCost, current.expenseCost, current.otherCost])) : money(0);
  const ev = evm({ bac, plannedToDate: pv, actualCost, progressPct: progress, method: p.progressMethod as ProgressMethod });

  const est = estimates[0];
  const recognizedRevenue = money(sum(recognized.map((r) => r.amount)));
  const fallbackRemainingHours = current ? Math.max(0, dec(current.effortHours).minus(actualHours).toNumber()) : 0;
  const avgCost = actualHours.gt(0) ? laborCost.div(actualHours) : current && dec(current.effortHours).gt(0) ? dec(current.laborCost).div(current.effortHours) : dec(0);
  const forecast = forecastAtCompletion({
    actualCost,
    committedNotRealized,
    etcLabor: est ? est.remainingLaborCost : money(avgCost.times(fallbackRemainingHours)),
    etcThirdPartyUncommitted: est ? est.remainingThirdPartyUncommitted : money(0),
    etcExpenses: est ? est.remainingExpenses : money(0),
    recognizedRevenue,
    remainingRevenue: est ? est.remainingRevenue : money(dec(current?.revenue ?? 0).minus(recognizedRevenue).gt(0) ? dec(current?.revenue ?? 0).minus(recognizedRevenue) : 0),
  });

  // Sinais (portfólio)
  const overdueTasks = workTasks.filter((t) => t.status !== "DONE" && t.plannedEnd && toCivil(t.plannedEnd) < today).length;
  const late = (p.plannedEnd && toCivil(p.plannedEnd) < today && !["COMPLETED", "CANCELED"].includes(p.status)) || overdueTasks > 0;
  const overBudget = current ? forecast.cost.gt(bac) : false;
  const lowMargin = forecast.marginPct !== null && forecast.marginPct.lt(15);
  const pendingAcceptance = workTasks.filter((t) => t.requiresAcceptance && t.status === "DONE" && t.acceptanceStatus !== "ACCEPTED").length;
  const unbilledEntries = entries.filter((e) => e.billable && ["ELIGIBLE", "BLOCKED"].includes(e.billingStatus));
  const unbilled = money(sum(unbilledEntries.map((e) => dec(e.hours).times(dec(e.sellRate ?? 0)))));

  return {
    project: p, original, current, baselines, progress, actualHours, laborCost, thirdPartyCost, expenseCost, actualCost, committedNotRealized, bac, pv: money(pv), evm: ev,
    estimate: est ?? null, forecast, recognizedRevenue,
    plannedHours: current ? qty(current.effortHours) : qty(0), hoursPct: pct(actualHours, current?.effortHours ?? 0),
    flags: { late, overdueTasks, overBudget, lowMargin, pendingAcceptance, unbilled, unbilledCount: unbilledEntries.length },
  };
}

export type ProjectAnalytics = NonNullable<Awaited<ReturnType<typeof projectAnalytics>>>;
