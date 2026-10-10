import Link from "@/components/ui/access-link";
import { PageHeader, Badge, Grid, Stat, StatusBadge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { projectAnalytics } from "@/modules/projects/analytics";
import { nameMap } from "@/modules/config/lookups";
import { formatMoney, formatPct, sum } from "@/lib/money";

export const metadata = { title: "Portfólio" };
export default async function PortfolioPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "project.read");
  const projects = await ctx.db.project.findMany({ where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } }, orderBy: { code: "asc" } });
  const data = (await Promise.all(projects.map((p) => projectAnalytics(ctx, p.id)))).filter((x): x is NonNullable<typeof x> => !!x);
  const parties = await nameMap(ctx, "party", projects.map((p) => p.partyId));
  const showMoney = ctx.permissions.has("margin.view");
  const flagged = data.filter((d) => d.flags.late || d.flags.overBudget || d.flags.lowMargin || d.flags.pendingAcceptance || d.flags.unbilled.gt(0));
  return (
    <>
      <PageHeader title="Portfólio executivo" subtitle="Sinais: atraso, estouro de orçamento (EAC > orçamento vigente), margem prevista < 15%, entregáveis concluídos sem aceite e execução ainda não faturada." breadcrumbs={[{ label: "Projetos", href: "/app/projetos" }, { label: "Portfólio" }]} />
      <Grid cols={5}>
        <Stat label="Projetos em andamento" value={data.length} />
        <Stat label="Com atraso" value={data.filter((d) => d.flags.late).length} tone="warn" />
        <Stat label="Estouro de orçamento" value={data.filter((d) => d.flags.overBudget).length} tone="bad" />
        <Stat label="Sem aceite" value={data.filter((d) => d.flags.pendingAcceptance).length} tone="warn" />
        <Stat label="Executado não faturado" value={formatMoney(sum(data.map((d) => d.flags.unbilled)))} href="/app/faturamento/pendencias" />
      </Grid>
      <div className="mt-6">
        <DataTable rows={data.map((d) => ({ id: d.project.id, d }))} rowHref={(r) => `/app/projetos/${r.id}`} columns={[
          { key: "code", label: "Projeto", render: (r) => `${r.d.project.code} — ${r.d.project.name}` }, { key: "c", label: "Cliente", render: (r) => parties.get(r.d.project.partyId) },
          { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.d.project.status} /> }, { key: "p", label: "Avanço", align: "right", render: (r) => formatPct(r.d.progress) },
          { key: "h", label: "Horas real./plan.", align: "right", render: (r) => `${r.d.actualHours} / ${r.d.plannedHours}` },
          ...(showMoney ? [
            { key: "bac", label: "Orçamento custo", align: "right" as const, render: (r: { d: (typeof data)[number] }) => formatMoney(r.d.bac) },
            { key: "eac", label: "Custo previsto (EAC)", align: "right" as const, render: (r: { d: (typeof data)[number] }) => formatMoney(r.d.forecast.cost) },
            { key: "m", label: "Margem prevista", align: "right" as const, render: (r: { d: (typeof data)[number] }) => formatPct(r.d.forecast.marginPct) },
          ] : []),
          { key: "f", label: "Sinais", render: (r) => <div className="flex flex-wrap gap-1">{r.d.flags.late && <Badge tone="amber">Atraso</Badge>}{r.d.flags.overBudget && <Badge tone="red">Orçamento</Badge>}{r.d.flags.lowMargin && <Badge tone="red">Margem</Badge>}{r.d.flags.pendingAcceptance > 0 && <Badge tone="amber">Sem aceite</Badge>}{r.d.flags.unbilled.gt(0) && <Badge tone="violet">A faturar</Badge>}</div> },
        ]} />
      </div>
      {flagged.length === 0 && data.length > 0 && <p className="mt-3 text-sm text-emerald-700">Nenhum projeto com sinal de risco.</p>}
      <p className="mt-3 text-xs text-slate-500">Visão de capacidade e demanda: <Link className="underline" href="/app/recursos">Recursos e alocação</Link>.</p>
    </>
  );
}
