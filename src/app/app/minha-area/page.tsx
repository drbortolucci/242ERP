import Link from "next/link";
import { getTerms } from "@/modules/sectors/service";
import { PageHeader, Card, Grid, Stat, StatusBadge, Notice } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { requireCtx } from "@/server/auth/next";
import { capacityGrid, weekStart } from "@/modules/resources/service";
import { nameMap } from "@/modules/config/lookups";
import { addDays, civil, formatCivil, todayIn } from "@/lib/dates";
import { formatQty, formatMoney, sum } from "@/lib/money";

export const metadata = { title: "Minha área" };
/** Minha área do profissional: alocações, atividades, horas, chamados, despesas, aprovações pendentes e calendário. */
export default async function MyArea() {
  const ctx = await requireCtx();
  const terms = await getTerms(ctx);
  const pid = ctx.professionalId;
  if (!pid) return <><PageHeader title="Minha área" /><Notice tone="warn">Seu usuário não está vinculado a um profissional.</Notice></>;
  const today = todayIn(ctx.timezone);
  const ws = weekStart(today);
  const [allocs, tasks, entries, tickets, expenses, absences, grid] = await Promise.all([
    ctx.db.allocation.findMany({ where: { professionalId: pid, status: { in: ["TENTATIVE", "CONFIRMED"] }, endDate: { gte: civil(today) } }, orderBy: { startDate: "asc" } }),
    ctx.db.projectTask.findMany({ where: { assigneeProfessionalId: pid, status: { not: "DONE" } }, orderBy: { plannedEnd: "asc" } }),
    ctx.db.timeEntry.findMany({ where: { professionalId: pid, date: { gte: civil(ws), lte: civil(addDays(ws, 6)) } } }),
    ctx.db.ticket.findMany({ where: { assigneeProfessionalId: pid, status: { notIn: ["RESOLVED", "CLOSED", "CANCELED"] } }, orderBy: { resolutionDueAt: "asc" } }),
    ctx.db.expense.findMany({ where: { professionalId: pid, status: { in: ["DRAFT", "SUBMITTED", "REJECTED"] } } }),
    ctx.db.absence.findMany({ where: { professionalId: pid, endDate: { gte: civil(today) } } }),
    capacityGrid(ctx, [pid], ws, addDays(ws, 6)),
  ]);
  const proj = await nameMap(ctx, "project", [...allocs.map((a) => a.projectId), ...tasks.map((t) => t.projectId)]);
  const pendingApprovals = ctx.permissions.has("time.approve") ? await ctx.db.timeEntry.count({ where: { status: "SUBMITTED" } }) : 0;
  const row = grid.rows[0];
  return (
    <>
      <PageHeader title="Minha área" subtitle={`Semana de ${formatCivil(ws)}`} />
      <Grid cols={5}>
        <Stat label="Capacidade da semana" value={`${formatQty(row?.capacity ?? 0)}h`} />
        <Stat label="Alocado na semana" value={`${formatQty(row?.allocated ?? 0)}h`} />
        <Stat label="Apontado na semana" value={`${formatQty(sum(entries.map((e) => e.hours)))}h`} href="/app/horas" hint={`${entries.filter((e) => e.status === "DRAFT").length} rascunho(s)`} />
        <Stat label="Chamados atribuídos" value={tickets.length} href="/app/ams/chamados?meus=1" />
        <Stat label="Despesas em aberto" value={expenses.length} href="/app/despesas" hint={formatMoney(sum(expenses.map((e) => e.amount)))} />
      </Grid>
      {pendingApprovals > 0 && <div className="mt-4"><Notice tone="info"><Link className="underline" href="/app/horas/aprovacao">{pendingApprovals} apontamento(s) aguardando sua aprovação.</Link></Notice></div>}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Minhas alocações"><DataTable dense rows={allocs} columns={[{ key: "p", label: "Projeto", render: (a) => a.projectId ? <Link className="text-brand-700 underline" href={`/app/projetos/${a.projectId}`}>{proj.get(a.projectId)}</Link> : "—" }, { key: "per", label: "Período", render: (a) => `${formatCivil(a.startDate)} – ${formatCivil(a.endDate)}` }, { key: "h", label: "Horas", align: "right", render: (a) => formatQty(a.totalHours) }, { key: "s", label: "Situação", render: (a) => <StatusBadge status={a.status} /> }]} empty={<p className="text-sm text-slate-500">Sem alocações.</p>} /></Card>
        <Card title="Minhas atividades"><DataTable dense rows={tasks} columns={[{ key: "p", label: "Projeto", render: (t) => proj.get(t.projectId) }, { key: "n", label: "Atividade", render: (t) => `${t.wbsCode} ${t.name}` }, { key: "e", label: "Prazo", render: (t) => <span className={t.plannedEnd && t.plannedEnd < civil(today) ? "text-red-700" : ""}>{formatCivil(t.plannedEnd)}</span> }, { key: "s", label: "Situação", render: (t) => <StatusBadge status={t.status} /> }]} empty={<p className="text-sm text-slate-500">Sem atividades atribuídas.</p>} /></Card>
        <Card title={terms.tickets}><DataTable dense rows={tickets} rowHref={(t) => `/app/ams/chamados/${t.id}`} columns={[{ key: "number", label: "Nº" }, { key: "title", label: "Título" }, { key: "priority", label: "Prior." }, { key: "s", label: "Situação", render: (t) => <StatusBadge status={t.status} /> }]} empty={<p className="text-sm text-slate-500">Nenhum.</p>} /></Card>
        <Card title="Calendário (ausências programadas)">{absences.length ? <ul className="text-sm">{absences.map((a) => <li key={a.id}>{a.type}: {formatCivil(a.startDate)} – {formatCivil(a.endDate)}</li>)}</ul> : <p className="text-sm text-slate-500">Sem ausências programadas.</p>}</Card>
      </div>
    </>
  );
}
