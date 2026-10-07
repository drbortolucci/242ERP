/**
 * Painéis por perfil: cada bloco aparece conforme as permissões do usuário e cada indicador aponta para a tela de
 * origem (rastreável). Valores de margem/custo só com `margin.view`/`controlling.read`.
 */
import type { Ctx } from "@/server/context";
import { addDays, addMonths, civil, monthStart, todayIn } from "@/lib/dates";
import { dec, money, sum } from "@/lib/money";
import { crmMetrics } from "../crm/service";
import { OPEN_STATUSES } from "../ams/tickets";
import { accountBalances } from "../finance/treasury";
import { projectAnalytics } from "../projects/analytics";
import { hourBankSummary } from "../ams/hour-bank";

export interface Metric { label: string; value: string | number; href: string; hint?: string; tone?: "default" | "good" | "warn" | "bad" }
export interface Section { key: string; title: string; metrics: Metric[] }

const fmt = (v: { toString(): string } | number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v.toString()));

export async function dashboardFor(ctx: Ctx): Promise<Section[]> {
  const can = (p: string) => ctx.permissions.has(p);
  const today = todayIn(ctx.timezone);
  const cur = monthStart(today);
  const prev = addMonths(cur, -1);
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const out: Section[] = [];

  // Aprovações pendentes para o usuário (qualquer perfil)
  const myApprovals = await ctx.db.approvalRequest.count({ where: { status: "PENDING", requiredPermission: { in: [...ctx.permissions] }, requestedById: { not: ctx.userId } } });

  if (can("controlling.read") && (can("margin.view") || can("cost.view"))) {
    const accounts = await ctx.db.managerialAccount.findMany({ select: { id: true, type: true, systemKey: true } });
    const type = new Map(accounts.map((a) => [a.id, a.type]));
    const entries = await ctx.db.managerialEntry.groupBy({ by: ["accountId"], where: { competence: { gte: civil(yearStart), lte: civil(cur) } }, _sum: { amount: true } });
    const t = (k: string) => money(sum(entries.filter((e) => type.get(e.accountId) === k).map((e) => e._sum.amount ?? 0)));
    const net = t("REVENUE").minus(t("DEDUCTION"));
    const margin = net.minus(t("DIRECT_COST"));
    const fin = accounts.filter((a) => a.type === "FINANCIAL");
    const finNet = sum(entries.filter((e) => fin.some((f) => f.id === e.accountId && f.systemKey === "FIN_INCOME")).map((e) => e._sum.amount ?? 0)).minus(sum(entries.filter((e) => fin.some((f) => f.id === e.accountId && f.systemKey !== "FIN_INCOME")).map((e) => e._sum.amount ?? 0)));
    const result = margin.minus(t("OPERATING_EXPENSE")).plus(finNet);
    const prevRev = (await ctx.db.managerialEntry.aggregate({ where: { competence: civil(prev), accountId: { in: accounts.filter((a) => a.type === "REVENUE").map((a) => a.id) } }, _sum: { amount: true } }))._sum.amount ?? 0;
    out.push({ key: "director", title: "Resultado (gerencial)", metrics: [
      { label: "Receita líquida no ano", value: fmt(net), href: "/app/controladoria/dre" },
      { label: "Receita do mês anterior", value: fmt(prevRev), href: `/app/controladoria/razao?de=${prev.slice(0, 7)}&ate=${prev.slice(0, 7)}` },
      { label: "Margem de contribuição no ano", value: fmt(margin), hint: net.isZero() ? undefined : `${margin.div(net).times(100).toFixed(1)}%`, href: "/app/controladoria/dre", tone: margin.lt(0) ? "bad" : "good" },
      { label: "Resultado gerencial no ano", value: fmt(result), href: "/app/controladoria/dre", tone: result.lt(0) ? "bad" : "good" },
    ] });
  }
  if (can("finance.read")) {
    const [bal, overdue, payWeek, pendingLines] = await Promise.all([
      accountBalances(ctx),
      ctx.db.receivable.aggregate({ where: { status: { in: ["OPEN", "PARTIAL"] }, dueDate: { lt: civil(today) } }, _sum: { openAmount: true }, _count: true }),
      ctx.db.payable.aggregate({ where: { status: { in: ["OPEN", "PARTIAL", "PENDING_APPROVAL"] }, dueDate: { lte: civil(addDays(today, 7)) } }, _sum: { openAmount: true }, _count: true }),
      ctx.db.bankStatementLine.count({ where: { status: "PENDING" } }),
    ]);
    out.push({ key: "finance", title: "Caixa e títulos", metrics: [
      { label: "Caixa consolidado (livro)", value: fmt(sum(bal.map((b) => b.balance))), href: "/app/financeiro/tesouraria" },
      { label: "A receber vencido", value: fmt(overdue._sum.openAmount ?? 0), hint: `${overdue._count} título(s)`, href: "/app/financeiro/receber", tone: overdue._count ? "bad" : "default" },
      { label: "A pagar em 7 dias", value: fmt(payWeek._sum.openAmount ?? 0), hint: `${payWeek._count} título(s)`, href: "/app/financeiro/pagar", tone: payWeek._count ? "warn" : "default" },
      { label: "Extrato a conciliar", value: pendingLines, href: "/app/financeiro/conciliacao", tone: pendingLines ? "warn" : "default" },
    ] });
  }
  if (can("billing.read")) {
    const [eligibleHours, accepted, measPending, clientPending] = await Promise.all([
      ctx.db.timeEntry.aggregate({ where: { billingStatus: "ELIGIBLE" }, _sum: { hours: true } }),
      ctx.db.contractMilestone.aggregate({ where: { status: "ACCEPTED" }, _sum: { amount: true }, _count: true }),
      ctx.db.measurement.count({ where: { status: { in: ["DRAFT", "PENDING_APPROVAL"] } } }),
      ctx.db.timeEntry.aggregate({ where: { clientApproval: "PENDING", status: "APPROVED" }, _sum: { hours: true } }),
    ]);
    out.push({ key: "billing", title: "Faturamento", metrics: [
      { label: "Horas elegíveis não medidas", value: Number(eligibleHours._sum.hours ?? 0).toFixed(2), href: "/app/faturamento/pendencias" },
      { label: "Marcos aceitos a faturar", value: fmt(accepted._sum.amount ?? 0), hint: `${accepted._count} marco(s)`, href: "/app/faturamento/pendencias" },
      { label: "Medições em rascunho/aprovação", value: measPending, href: "/app/faturamento/medicoes", tone: measPending ? "warn" : "default" },
      { label: "Horas aguardando o cliente", value: Number(clientPending._sum.hours ?? 0).toFixed(2), href: "/app/horas/aprovacao", tone: dec(clientPending._sum.hours ?? 0).gt(0) ? "warn" : "default" },
    ] });
  }
  if (can("crm.read")) {
    const m = await crmMetrics(ctx);
    const props = await ctx.db.proposal.count({ where: { status: "PENDING_APPROVAL" } });
    out.push({ key: "crm", title: "Comercial", metrics: [
      { label: "Pipeline ponderado", value: fmt(m.pipelineWeighted), hint: `bruto ${fmt(m.pipelineGross)}`, href: "/app/crm/oportunidades" },
      { label: "Oportunidades abertas", value: m.openCount, href: "/app/crm/oportunidades" },
      { label: "Sem atividade recente", value: m.stale.length, href: "/app/crm/oportunidades", tone: m.stale.length ? "warn" : "default" },
      { label: "Propostas aguardando aprovação", value: props, href: "/app/propostas", tone: props ? "warn" : "default" },
    ] });
  }
  if (can("project.read")) {
    const projects = await ctx.db.project.findMany({ where: { status: { in: ["ACTIVE", "PLANNING", "ON_HOLD"] } }, select: { id: true } });
    const flags = (await Promise.all(projects.map((p) => projectAnalytics(ctx, p.id)))).filter((a) => a).map((a) => a!.flags);
    const timeSubmitted = can("time.approve") ? await ctx.db.timeEntry.count({ where: { status: "SUBMITTED" } }) : 0;
    out.push({ key: "projects", title: "Projetos", metrics: [
      { label: "Projetos em andamento", value: projects.length, href: "/app/projetos/portfolio" },
      { label: "Com atraso", value: flags.filter((f) => f.late).length, href: "/app/projetos/portfolio", tone: flags.some((f) => f.late) ? "bad" : "default" },
      ...(can("margin.view") ? [{ label: "Estouro ou margem baixa", value: flags.filter((f) => f.overBudget || f.lowMargin).length, href: "/app/controladoria/pl", tone: flags.some((f) => f.overBudget || f.lowMargin) ? ("bad" as const) : ("default" as const) }] : []),
      { label: "Horas aguardando aprovação", value: timeSubmitted, href: "/app/horas/aprovacao", tone: timeSubmitted ? "warn" : "default" },
    ] });
  }
  if (can("ams.read")) {
    const open = await ctx.db.ticket.findMany({ where: { status: { in: OPEN_STATUSES } }, select: { escalationLevel: true, resolutionBreached: true, responseBreached: true, assigneeProfessionalId: true } });
    const low = can("ams.manage") ? (await Promise.all((await ctx.db.contract.findMany({ where: { commercialModel: "AMS_RECURRING", status: "ACTIVE" }, select: { id: true } })).map((c) => hourBankSummary(ctx, c.id)))).filter((s) => s.lowBalance).length : null;
    out.push({ key: "ams", title: "Sustentação (AMS)", metrics: [
      { label: "Chamados abertos", value: open.length, href: "/app/ams/chamados" },
      { label: "Em risco de SLA", value: open.filter((t) => t.escalationLevel === 1 && !t.resolutionBreached).length, href: "/app/ams/chamados?sla=risk", tone: "warn" },
      { label: "SLA violado (abertos)", value: open.filter((t) => t.responseBreached || t.resolutionBreached).length, href: "/app/ams/chamados?sla=breached", tone: open.some((t) => t.resolutionBreached) ? "bad" : "default" },
      ...(low !== null ? [{ label: "Contratos com saldo baixo", value: low, href: "/app/ams/saldos", tone: low ? ("warn" as const) : ("default" as const) }] : [{ label: "Sem responsável", value: open.filter((t) => !t.assigneeProfessionalId).length, href: "/app/ams/chamados" }]),
    ] });
  }
  if (can("purchase.write") || can("purchase.approve")) {
    const [reqs, pos, divergent, renewals] = await Promise.all([
      ctx.db.purchaseRequisition.count({ where: { status: { in: ["SUBMITTED", "APPROVED", "QUOTING"] } } }), ctx.db.purchaseOrder.count({ where: { status: "PENDING_APPROVAL" } }),
      ctx.db.supplierInvoice.count({ where: { status: "DIVERGENT" } }), ctx.db.asset.count({ where: { renewalDate: { lte: civil(addDays(today, 60)) }, status: { not: "RETIRED" } } }),
    ]);
    out.push({ key: "procurement", title: "Suprimentos", metrics: [
      { label: "Requisições em andamento", value: reqs, href: "/app/suprimentos/requisicoes" },
      { label: "Pedidos aguardando aprovação", value: pos, href: "/app/suprimentos/pedidos?status=PENDING_APPROVAL", tone: pos ? "warn" : "default" },
      { label: "Documentos divergentes", value: divergent, href: "/app/suprimentos/notas", tone: divergent ? "bad" : "default" },
      { label: "Renovações em 60 dias", value: renewals, href: "/app/suprimentos/ativos", tone: renewals ? "warn" : "default" },
    ] });
  }
  if (can("period.close")) {
    const companies = await ctx.db.company.findMany({ where: { active: true }, select: { id: true } });
    const closed = await ctx.db.accountingPeriod.count({ where: { month: civil(prev), status: "CLOSED", companyId: { in: companies.map((c) => c.id) } } });
    out.push({ key: "closing", title: "Fechamento", metrics: [{ label: `Empresas com ${prev.slice(5, 7)}/${prev.slice(0, 4)} em aberto`, value: companies.length - closed, href: "/app/controladoria/fechamento", tone: companies.length - closed ? "warn" : "good" }] });
  }
  if (ctx.professionalId && can("time.write")) {
    const ws = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
    const [hours, drafts, tickets] = await Promise.all([
      ctx.db.timeEntry.aggregate({ where: { professionalId: ctx.professionalId, date: { gte: civil(ws), lte: civil(addDays(ws, 6)) } }, _sum: { hours: true } }),
      ctx.db.timeEntry.count({ where: { professionalId: ctx.professionalId, status: { in: ["DRAFT", "REJECTED"] } } }),
      ctx.db.ticket.count({ where: { assigneeProfessionalId: ctx.professionalId, status: { in: OPEN_STATUSES } } }),
    ]);
    out.push({ key: "me", title: "Minha semana", metrics: [
      { label: "Horas apontadas na semana", value: Number(hours._sum.hours ?? 0).toFixed(2), href: "/app/horas" },
      { label: "Rascunhos/recusados a enviar", value: drafts, href: "/app/horas", tone: drafts ? "warn" : "default" },
      { label: "Chamados atribuídos", value: tickets, href: "/app/minha-area" },
    ] });
  }
  if (myApprovals) out.unshift({ key: "approvals", title: "Pendências para você", metrics: [{ label: "Aprovações aguardando sua decisão", value: myApprovals, href: "/app/aprovacoes", tone: "warn" }] });
  return out;
}
