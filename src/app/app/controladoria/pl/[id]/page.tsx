import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card, Notice } from "@/components/ui/page";
import { requireCtx } from "@/server/auth/next";
import { pageAnyPerm } from "@/server/page-guard";
import { projectPl } from "@/modules/controlling/service";
import { formatMoney, formatQty } from "@/lib/money";

export default async function ProjectPlPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  pageAnyPerm(ctx, "controlling.read", "margin.view");
  const pl = await projectPl(ctx, id).catch(() => null);
  if (!pl) notFound();
  const p = pl.analytics.project;
  type Col = { revenue: unknown; labor?: unknown; thirdParty?: unknown; expenses?: unknown; cost: unknown; margin: unknown; marginPct: { toFixed(n: number): string } | null } | null;
  const cols: [string, Col][] = [["Original (v1)", pl.original], ["Revisado (vigente)", pl.revised], ["Realizado", pl.actual], ["Previsto ao término", { ...pl.forecast }]];
  const cell = (v: unknown) => (v === undefined || v === null ? "—" : formatMoney(String(v)));
  const rows: [string, (c: NonNullable<Col>) => unknown][] = [["Receita líquida", (c) => c.revenue], ["Pessoal", (c) => c.labor], ["Terceiros", (c) => c.thirdParty], ["Despesas", (c) => c.expenses], ["Custo total", (c) => c.cost], ["Margem", (c) => c.margin]];
  return (
    <>
      <PageHeader title={`P&L — ${p.code} ${p.name}`} breadcrumbs={[{ label: "P&L de projetos", href: "/app/controladoria/pl" }, { label: p.code }]} actions={<Link className="rounded border px-3 py-1.5 text-sm" href={`/app/projetos/${id}`}>Abrir projeto</Link>} />
      <Card>
        <table className="min-w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500"><th className="p-1" />{cols.map(([l]) => <th key={l} className="p-1 text-right">{l}</th>)}</tr></thead>
          <tbody>
            {rows.map(([label, pick]) => <tr key={label} className={`border-t ${label === "Margem" ? "font-semibold" : ""}`}><td className="p-1">{label}</td>{cols.map(([l, c]) => <td key={l} className="p-1 text-right tabular-nums">{c ? cell(pick(c)) : "—"}</td>)}</tr>)}
            <tr className="border-t"><td className="p-1">Margem %</td>{cols.map(([l, c]) => <td key={l} className="p-1 text-right">{c?.marginPct ? `${c.marginPct.toFixed(1)}%` : "—"}</td>)}</tr>
          </tbody>
        </table>
        <p className="mt-3 text-xs text-slate-500">Realizado = lançamentos do razão gerencial com o projeto (receita reconhecida líquida de deduções; custos de pessoal pelas horas aprovadas, terceiros pelos documentos aprovados, despesas aprovadas). Rateios de despesas indiretas: {formatMoney(pl.actual.overhead)} (não incluídos na margem de contribuição). Previsto = realizado + compromissos abertos + estimativa para terminar (ETC).</p>
      </Card>
      <Card title="Indicadores de execução" className="mt-6">
        <p className="text-sm">Horas aprovadas: {formatQty(pl.analytics.actualHours)} de {formatQty(pl.analytics.plannedHours)} planejadas · Avanço: {pl.analytics.progress === null ? "—" : `${pl.analytics.progress.toFixed(1)}%`} · Comprometido não realizado: {formatMoney(pl.analytics.committedNotRealized)}</p>
        {!pl.original && <div className="mt-2"><Notice tone="warn">Projeto sem linha de base: comparações original/revisado indisponíveis.</Notice></div>}
      </Card>
    </>
  );
}
