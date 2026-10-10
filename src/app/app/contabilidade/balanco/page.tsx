import { PageHeader, Card, Notice } from "@/components/ui/page";
import { requireCtx } from "@/server/auth/next";
import { lookups } from "@/modules/config/lookups";
import { balanceSheet } from "@/modules/accounting/service";
import { formatMoney } from "@/lib/money";
import type { SearchParams } from "@/lib/query";
import { FilterBar, periodFrom } from "../filters";

export const metadata = { title: "Balanço patrimonial" };
export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  const { to, companyId } = periodFrom(s, ctx.timezone);
  const [bs, companies] = await Promise.all([balanceSheet(ctx, companyId, to), lookups.companies(ctx)]);
  const side = (natures: string[]) => bs.rows.filter((r) => natures.includes(r.nature) && !r.closing.isZero());
  const Block = ({ title, natures, total, extra }: { title: string; natures: string[]; total: ReturnType<typeof formatMoney>; extra?: React.ReactNode }) => (
    <Card title={title}>
      <table className="w-full text-sm"><tbody>
        {side(natures).map((r) => <tr key={r.id} className={r.analytic ? "" : "font-semibold"}><td style={{ paddingLeft: `${(r.level - 1) * 12}px` }}>{r.code} {r.name}</td><td className="text-right tabular-nums">{formatMoney(r.closing)}</td></tr>)}
        {extra}
        <tr className="border-t font-bold"><td>Total</td><td className="text-right">{total}</td></tr>
      </tbody></table>
    </Card>
  );
  return (
    <>
      <PageHeader title="Balanço patrimonial" subtitle="Posição na data; o resultado do exercício ainda não encerrado aparece no patrimônio líquido" breadcrumbs={[{ label: "Contabilidade" }, { label: "Balanço" }]} />
      <FilterBar base="/app/contabilidade/balanco" companies={companies} to={to} companyId={companyId} single />
      {!bs.balanced && <Notice tone="error">Ativo diferente de passivo + PL: há lançamentos desbalanceados ou contas sem natureza correta.</Notice>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Block title="Ativo" natures={["ASSET"]} total={formatMoney(bs.assets)} />
        <Block title="Passivo e patrimônio líquido" natures={["LIABILITY", "EQUITY"]} total={formatMoney(bs.liabilitiesAndEquity)} extra={<tr><td>Resultado do exercício (não encerrado)</td><td className="text-right tabular-nums">{formatMoney(bs.result)}</td></tr>} />
      </div>
      <p className="mt-3 text-xs text-slate-500">Demonstração gerada a partir dos lançamentos do sistema; não substitui as demonstrações assinadas pelo contador nem a escrituração oficial (ECD/ECF).</p>
    </>
  );
}
