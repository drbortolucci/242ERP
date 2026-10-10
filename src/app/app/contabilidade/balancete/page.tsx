import Link from "@/components/ui/access-link";
import { PageHeader, Notice } from "@/components/ui/page";
import { requireCtx } from "@/server/auth/next";
import { lookups } from "@/modules/config/lookups";
import { trialBalance } from "@/modules/accounting/service";
import { formatMoney, sum } from "@/lib/money";
import type { SearchParams } from "@/lib/query";
import { FilterBar, periodFrom } from "../filters";

export const metadata = { title: "Balancete" };
export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  const { from, to, companyId } = periodFrom(s, ctx.timezone);
  const [rows, companies] = await Promise.all([trialBalance(ctx, companyId, from, to), lookups.companies(ctx)]);
  const leaf = rows.filter((r) => r.analytic);
  const td = sum(leaf.map((r) => r.debit)), tc = sum(leaf.map((r) => r.credit));
  return (
    <>
      <PageHeader title="Balancete de verificação" subtitle="Saldo anterior, débitos, créditos e saldo final no sentido natural de cada conta" breadcrumbs={[{ label: "Contabilidade" }, { label: "Balancete" }]}
        actions={companyId && <a className="rounded border px-3 py-1.5 text-sm" href={`/api/contabilidade/diario?empresa=${companyId}&de=${from}&ate=${to}`}>Exportar diário (CSV)</a>} />
      <FilterBar base="/app/contabilidade/balancete" companies={companies} from={from} to={to} companyId={companyId} />
      {!td.eq(tc) && <Notice tone="error">Débitos e créditos do período não fecham — verifique lançamentos importados.</Notice>}
      <table className="w-full rounded border bg-white text-sm">
        <thead><tr className="border-b bg-slate-50 text-left text-xs text-slate-500"><th className="px-2 py-1">Conta</th><th className="text-right">Saldo anterior</th><th className="text-right">Débitos</th><th className="text-right">Créditos</th><th className="text-right">Saldo final</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className={`border-b ${r.analytic ? "" : "bg-slate-50 font-semibold"}`}>
            <td className="px-2 py-1" style={{ paddingLeft: `${8 + (r.level - 1) * 12}px` }}>{r.analytic ? <Link className="text-brand-700 hover:underline" href={`/app/contabilidade/razao?conta=${r.id}&de=${from}&ate=${to}${companyId ? `&empresa=${companyId}` : ""}`}>{r.code} {r.name}</Link> : `${r.code} ${r.name}`}</td>
            <td className="text-right tabular-nums">{formatMoney(r.opening)}</td><td className="text-right tabular-nums">{formatMoney(r.debit)}</td><td className="text-right tabular-nums">{formatMoney(r.credit)}</td><td className="text-right tabular-nums">{formatMoney(r.closing)}</td>
          </tr>
        ))}</tbody>
        <tfoot><tr className="bg-slate-100 font-semibold"><td className="px-2 py-1">Totais do período (contas analíticas)</td><td /><td className="text-right">{formatMoney(td)}</td><td className="text-right">{formatMoney(tc)}</td><td /></tr></tfoot>
      </table>
    </>
  );
}
