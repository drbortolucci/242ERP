import { PageHeader, StatusBadge, Badge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { nameMap } from "@/modules/config/lookups";
import { projectPl } from "@/modules/controlling/service";
import { formatMoney } from "@/lib/money";

const pct = (v: { toFixed(n: number): string } | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

export const metadata = { title: "P&L de projetos" };
export default async function PlPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "controlling.read");
  const projects = await ctx.db.project.findMany({ where: { status: { notIn: ["CANCELED"] } }, orderBy: { code: "asc" } });
  const rows = await Promise.all(projects.map(async (p) => ({ id: p.id, p, pl: await projectPl(ctx, p.id) })));
  const pn = await nameMap(ctx, "party", projects.map((p) => p.partyId));
  return (
    <>
      <PageHeader title="P&L de projetos" subtitle="Linha de base original × revisada × realizado (razão gerencial) × previsto ao término" breadcrumbs={[{ label: "Controladoria" }, { label: "P&L de projetos" }]} />
      <DataTable rows={rows} rowHref={(r) => `/app/controladoria/pl/${r.id}`} columns={[
        { key: "p", label: "Projeto", render: (r) => `${r.p.code} ${r.p.name}` }, { key: "c", label: "Cliente", render: (r) => pn.get(r.p.partyId) },
        { key: "om", label: "Margem original", align: "right", render: (r) => pct(r.pl.original?.marginPct ?? null) }, { key: "rm", label: "Margem revisada", align: "right", render: (r) => pct(r.pl.revised?.marginPct ?? null) },
        { key: "ar", label: "Receita realizada", align: "right", render: (r) => formatMoney(r.pl.actual.revenue) }, { key: "ac", label: "Custo realizado", align: "right", render: (r) => formatMoney(r.pl.actual.cost) },
        { key: "am", label: "Margem realizada", align: "right", render: (r) => pct(r.pl.actual.marginPct) }, { key: "fm", label: "Margem prevista", align: "right", render: (r) => <span className={r.pl.forecast.marginPct && r.pl.forecast.marginPct.lt(15) ? "text-red-700" : ""}>{pct(r.pl.forecast.marginPct)}</span> },
        { key: "f", label: "Sinais", render: (r) => <span className="flex flex-wrap gap-1">{r.pl.analytics.flags.overBudget && <Badge tone="red">estouro</Badge>}{r.pl.analytics.flags.lowMargin && <Badge tone="amber">margem baixa</Badge>}</span> },
        { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.p.status} /> },
      ]} />
    </>
  );
}
