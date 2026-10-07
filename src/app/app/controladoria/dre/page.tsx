import Link from "next/link";
import { PageHeader, Card, Stat, Grid } from "@/components/ui/page";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { lookups } from "@/modules/config/lookups";
import { dre } from "@/modules/controlling/service";
import { sp, type SearchParams } from "@/lib/query";
import { addMonths, monthStart, todayIn } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Filters } from "../filters";

const ym = (v: string | undefined, fb: string) => (v ? `${v.slice(0, 7)}-01` : fb);

export const metadata = { title: "DRE gerencial" };
export default async function DrePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pagePerm(ctx, "controlling.read");
  const cur = monthStart(todayIn(ctx.timezone));
  const from = ym(sp(s, "de"), addMonths(cur, -5));
  const to = ym(sp(s, "ate"), cur);
  const f = { from, to, companyId: sp(s, "empresa"), costCenterId: sp(s, "cc"), businessUnitId: sp(s, "un") };
  const [d, companies, ccs, bus] = await Promise.all([dre(ctx, f), lookups.companies(ctx), lookups.costCenters(ctx), lookups.businessUnits(ctx)]);
  const label = (m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`;
  const Row = ({ name, values, total, strong, indent }: { name: string; values: { toString(): string }[]; total: { toString(): string }; strong?: boolean; indent?: boolean }) => (
    <tr className={`border-t ${strong ? "bg-slate-50 font-semibold" : ""}`}><td className={`p-1 ${indent ? "pl-5 text-slate-600" : ""}`}>{name}</td>{values.map((v, i) => <td key={i} className="p-1 text-right tabular-nums">{formatMoney(v.toString())}</td>)}<td className="p-1 text-right tabular-nums font-medium">{formatMoney(total.toString())}</td></tr>
  );
  const group = (type: string) => d.lines.filter((l) => l.account.type === type);
  const sum = (arr: { toString(): string }[]) => arr.reduce<number>((a, v) => a + Number(v.toString()), 0);
  const sec = (title: string, type: string, sub: { toString(): string }[]) => (
    <>
      <Row name={title} values={sub} total={sum(sub)} strong />
      {group(type).map((l) => <tr key={l.account.id} className="border-t"><td className="p-1 pl-5 text-slate-600"><Link className="hover:underline" href={`/app/controladoria/razao?conta=${l.account.id}&de=${from.slice(0, 7)}&ate=${to.slice(0, 7)}${f.companyId ? `&empresa=${f.companyId}` : ""}`}>{l.account.code} {l.account.name}</Link></td>{l.values.map((v, i) => <td key={i} className="p-1 text-right tabular-nums">{formatMoney(v)}</td>)}<td className="p-1 text-right tabular-nums">{formatMoney(l.total)}</td></tr>)}
    </>
  );
  const st = d.subtotals;
  return (
    <>
      <PageHeader title="DRE gerencial" subtitle="Demonstrativo gerencial por competência — não substitui a contabilidade oficial" breadcrumbs={[{ label: "Controladoria" }, { label: "DRE" }]} />
      <Filters from={from} to={to} companyId={f.companyId} companies={companies} extra={<>
        <label className="flex flex-col text-xs">Centro de custo<select name="cc" defaultValue={f.costCenterId ?? ""} className="rounded border px-2 py-1 text-sm"><option value="">Todos</option>{ccs.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
        <label className="flex flex-col text-xs">Unidade<select name="un" defaultValue={f.businessUnitId ?? ""} className="rounded border px-2 py-1 text-sm"><option value="">Todas</option>{bus.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
      </>} />
      <Grid cols={4}>
        <Stat label="Receita líquida" value={formatMoney(d.totals.net)} />
        <Stat label="Margem de contribuição" value={formatMoney(d.totals.margin)} hint={d.totals.net.isZero() ? undefined : `${d.totals.margin.div(d.totals.net).times(100).toFixed(1)}%`} />
        <Stat label="Resultado operacional" value={formatMoney(d.totals.operating)} tone={d.totals.operating.lt(0) ? "bad" : "good"} />
        <Stat label="Resultado gerencial" value={formatMoney(d.totals.result)} tone={d.totals.result.lt(0) ? "bad" : "good"} />
      </Grid>
      <Card className="mt-6">
        <div className="overflow-x-auto"><table className="min-w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500"><th className="p-1">Conta</th>{d.months.map((m) => <th key={m} className="p-1 text-right">{label(m)}</th>)}<th className="p-1 text-right">Total</th></tr></thead>
          <tbody>
            {sec("Receita bruta", "REVENUE", st.revenue)}
            {sec("(−) Deduções", "DEDUCTION", st.deductions)}
            <Row name="= Receita líquida" values={st.net} total={d.totals.net} strong />
            {sec("(−) Custos diretos", "DIRECT_COST", st.direct)}
            <Row name="= Margem de contribuição" values={st.margin} total={d.totals.margin} strong />
            {sec("(−) Despesas operacionais (inclui pessoal não absorvido e rateios)", "OPERATING_EXPENSE", st.opex)}
            <Row name="= Resultado operacional" values={st.operating} total={d.totals.operating} strong />
            {sec("Resultado financeiro", "FINANCIAL", st.finIncome.map((v, i) => v.minus(st.finExpense[i])))}
            <Row name="= Resultado gerencial" values={st.result} total={d.totals.result} strong />
          </tbody>
        </table></div>
        <p className="mt-2 text-xs text-slate-500">Cada linha leva ao razão com os lançamentos e suas origens. Pessoal absorvido por projetos aparece como redutor das despesas de pessoal (o custo está nos projetos).</p>
      </Card>
    </>
  );
}
