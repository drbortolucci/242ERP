import Link from "@/components/ui/access-link";
import { PageHeader, Card } from "@/components/ui/page";
import { requireCtx } from "@/server/auth/next";
import { lookups } from "@/modules/config/lookups";
import { accountLedger } from "@/modules/accounting/service";
import { formatCivil } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { sp, type SearchParams } from "@/lib/query";
import { FilterBar, periodFrom } from "../filters";

export const metadata = { title: "Razão contábil" };
export default async function AccountLedgerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  const { from, to, companyId } = periodFrom(s, ctx.timezone);
  const accountId = sp(s, "conta");
  const [companies, accounts] = await Promise.all([lookups.companies(ctx), ctx.db.ledgerAccount.findMany({ where: { analytic: true }, orderBy: { code: "asc" } })]);
  const led = accountId ? await accountLedger(ctx, accountId, companyId, from, to) : null;
  return (
    <>
      <PageHeader title="Razão contábil" subtitle={led ? `${led.account.code} ${led.account.name}` : "Escolha uma conta"} breadcrumbs={[{ label: "Contabilidade" }, { label: "Balancete", href: "/app/contabilidade/balancete" }, { label: "Razão" }]} />
      <form method="get" className="mb-2 flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col"><span className="text-xs text-slate-500">Conta</span><select name="conta" defaultValue={accountId ?? ""} className="rounded border border-slate-300 px-2 py-1">{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></label>
        <input type="hidden" name="de" value={from} /><input type="hidden" name="ate" value={to} />{companyId && <input type="hidden" name="empresa" value={companyId} />}
        <button className="rounded border px-3 py-1">Abrir</button>
      </form>
      <FilterBar base={`/app/contabilidade/razao`} companies={companies} from={from} to={to} companyId={companyId} />
      {led && (
        <Card>
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-slate-500"><th>Data</th><th>Lançamento</th><th>Histórico</th><th className="text-right">Débito</th><th className="text-right">Crédito</th><th className="text-right">Saldo</th></tr></thead>
            <tbody>
              <tr className="bg-slate-50"><td colSpan={5}>Saldo anterior</td><td className="text-right tabular-nums">{formatMoney(led.opening)}</td></tr>
              {led.rows.map((r) => <tr key={r.id} className="border-b"><td>{formatCivil(r.date)}</td><td><Link className="text-brand-700 hover:underline" href={`/app/contabilidade/lancamentos?q=${r.entry.number}`}>{r.entry.number}</Link></td><td>{r.entry.description}{r.memo ? ` — ${r.memo}` : ""}</td><td className="text-right tabular-nums">{Number(r.debit) ? formatMoney(r.debit) : ""}</td><td className="text-right tabular-nums">{Number(r.credit) ? formatMoney(r.credit) : ""}</td><td className="text-right tabular-nums">{formatMoney(r.balance)}</td></tr>)}
              <tr className="font-semibold"><td colSpan={5}>Saldo final</td><td className="text-right tabular-nums">{formatMoney(led.closing)}</td></tr>
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
