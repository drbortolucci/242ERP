import { PageHeader, Card, Stat, Grid } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { lookups } from "@/modules/config/lookups";
import { cashFlow } from "@/modules/finance/treasury";
import { sp, type SearchParams } from "@/lib/query";
import { addDays, formatCivil, todayIn } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Fluxo de caixa" };
export default async function CashFlowPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pagePerm(ctx, "finance.read");
  const today = todayIn(ctx.timezone);
  const from = sp(s, "de") ?? addDays(today, -30);
  const to = sp(s, "ate") ?? addDays(today, 90);
  const companyId = sp(s, "empresa");
  const [cf, companies] = await Promise.all([cashFlow(ctx, from, to, companyId), lookups.companies(ctx)]);
  const tot = cf.series.reduce((a, r) => ({ ri: a.ri + r.realizedIn, ro: a.ro + r.realizedOut, fi: a.fi + r.forecastIn, fo: a.fo + r.forecastOut }), { ri: 0, ro: 0, fi: 0, fo: 0 });
  const minBal = cf.series.reduce((m, r) => Math.min(m, r.balance), Number(cf.opening));
  return (
    <>
      <PageHeader title="Fluxo de caixa" subtitle="Realizado até hoje (movimentos bancários) e previsto (títulos em aberto e compromissos de compra)" breadcrumbs={[{ label: "Financeiro" }, { label: "Fluxo de caixa" }]} />
      <form className="mb-4 flex flex-wrap items-end gap-2 text-sm" method="get">
        <label className="flex flex-col text-xs">De<input type="date" name="de" defaultValue={from} className="rounded border px-2 py-1 text-sm" /></label>
        <label className="flex flex-col text-xs">Até<input type="date" name="ate" defaultValue={to} className="rounded border px-2 py-1 text-sm" /></label>
        <label className="flex flex-col text-xs">Empresa<select name="empresa" defaultValue={companyId ?? ""} className="rounded border px-2 py-1 text-sm"><option value="">Todas</option>{companies.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
        <button className="rounded bg-slate-800 px-3 py-1.5 text-white">Atualizar</button>
      </form>
      <Grid cols={5}>
        <Stat label="Saldo inicial" value={formatMoney(cf.opening)} />
        <Stat label="Entradas (realizado + previsto)" value={formatMoney(tot.ri + tot.fi)} tone="good" />
        <Stat label="Saídas (realizado + previsto)" value={formatMoney(tot.ro + tot.fo)} tone="bad" />
        <Stat label="Saldo final projetado" value={formatMoney(cf.closing)} />
        <Stat label="Menor saldo no período" value={formatMoney(minBal)} tone={minBal < 0 ? "bad" : "default"} />
      </Grid>
      <Card title="Movimento diário" className="mt-6">
        <DataTable dense rows={cf.series.map((r) => ({ ...r, id: r.date }))} columns={[
          { key: "d", label: "Data", render: (r) => <span className={r.date > today ? "text-slate-500" : ""}>{formatCivil(r.date)}{r.date > today ? " (previsto)" : ""}</span> },
          { key: "ri", label: "Entradas realizadas", align: "right", render: (r) => (r.realizedIn ? formatMoney(r.realizedIn) : "") }, { key: "ro", label: "Saídas realizadas", align: "right", render: (r) => (r.realizedOut ? formatMoney(r.realizedOut) : "") },
          { key: "fi", label: "A receber", align: "right", render: (r) => (r.forecastIn ? formatMoney(r.forecastIn) : "") }, { key: "fo", label: "A pagar", align: "right", render: (r) => (r.forecastOut ? formatMoney(r.forecastOut) : "") },
          { key: "b", label: "Saldo", align: "right", render: (r) => <span className={r.balance < 0 ? "text-red-700" : ""}>{formatMoney(r.balance)}</span> },
        ]} />
        <p className="mt-2 text-xs text-slate-500">Títulos vencidos em aberto aparecem na data de hoje. Compromissos de compra não faturados são estimados no fim da vigência do pedido (ou 30 dias após a data do pedido).</p>
      </Card>
    </>
  );
}
