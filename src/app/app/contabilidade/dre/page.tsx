import { PageHeader, Card } from "@/components/ui/page";
import { requireCtx } from "@/server/auth/next";
import { lookups } from "@/modules/config/lookups";
import { incomeStatement } from "@/modules/accounting/service";
import { formatMoney } from "@/lib/money";
import type { SearchParams } from "@/lib/query";
import { FilterBar, periodFrom } from "../filters";

export const metadata = { title: "DRE contábil" };
export default async function IncomeStatementPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  const { from, to, companyId } = periodFrom(s, ctx.timezone);
  const [d, companies] = await Promise.all([incomeStatement(ctx, companyId, from, to), lookups.companies(ctx)]);
  return (
    <>
      <PageHeader title="Demonstração do resultado (contábil)" subtitle="Pelos lançamentos contábeis do período — a DRE gerencial (por competência e projeto) fica na Controladoria" breadcrumbs={[{ label: "Contabilidade" }, { label: "DRE" }]} />
      <FilterBar base="/app/contabilidade/dre" companies={companies} from={from} to={to} companyId={companyId} />
      <Card>
        <table className="w-full text-sm"><tbody>
          <tr className="font-semibold"><td>Receitas</td><td className="text-right">{formatMoney(d.totalRevenue)}</td></tr>
          {d.revenues.map((r) => <tr key={r.id}><td className="pl-4">{r.code} {r.name}</td><td className="text-right tabular-nums">{formatMoney(r.amount)}</td></tr>)}
          <tr className="font-semibold"><td>(−) Custos e despesas</td><td className="text-right">{formatMoney(d.totalExpense)}</td></tr>
          {d.expenses.map((r) => <tr key={r.id}><td className="pl-4">{r.code} {r.name}</td><td className="text-right tabular-nums">{formatMoney(r.amount)}</td></tr>)}
          <tr className="border-t text-base font-bold"><td>Resultado do período</td><td className={`text-right ${d.result.lt(0) ? "text-red-700" : "text-emerald-700"}`}>{formatMoney(d.result)}</td></tr>
        </tbody></table>
        <p className="mt-3 text-xs text-slate-500">Antes de tributos sobre o lucro, que dependem do regime e da apuração do contador.</p>
      </Card>
    </>
  );
}
