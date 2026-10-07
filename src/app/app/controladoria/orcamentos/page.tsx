import { PageHeader, Card, StatusBadge, Badge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionForm, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { lookups, nameMap } from "@/modules/config/lookups";
import { budgetVsActual } from "@/modules/controlling/service";
import { sp, type SearchParams } from "@/lib/query";
import { todayIn } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { createBudgetAction } from "../actions";

export const metadata = { title: "Orçamentos" };
export default async function BudgetsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pagePerm(ctx, "controlling.read");
  const companies = await lookups.companies(ctx);
  const companyId = sp(s, "empresa") ?? companies[0]?.value;
  const year = Number(sp(s, "ano") ?? todayIn(ctx.timezone).slice(0, 4));
  const [budgets, bva, cn] = await Promise.all([ctx.db.budget.findMany({ orderBy: [{ year: "desc" }, { kind: "asc" }, { version: "desc" }] }), companyId ? budgetVsActual(ctx, companyId, year) : null, nameMap(ctx, "company", companies.map((c) => c.value))]);
  return (
    <>
      <PageHeader title="Orçamentos e forecasts" breadcrumbs={[{ label: "Controladoria" }, { label: "Orçamentos" }]} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Versões">
            <DataTable dense rows={budgets} rowHref={(b) => `/app/controladoria/orcamentos/${b.id}`} columns={[{ key: "n", label: "Nome", render: (b) => b.name }, { key: "c", label: "Empresa", render: (b) => cn.get(b.companyId) }, { key: "y", label: "Ano", render: (b) => b.year }, { key: "k", label: "Tipo", render: (b) => <Badge tone={b.kind === "BUDGET" ? "blue" : "violet"}>{b.kind === "BUDGET" ? "Orçamento" : "Forecast"}</Badge> }, { key: "v", label: "Versão", render: (b) => `v${b.version}` }, { key: "s", label: "Situação", render: (b) => <StatusBadge status={b.status} /> }]} />
          </Card>
          {bva && (
            <Card title={`Orçado × realizado ${year} (${bva.budget ? `${bva.budget.name} v${bva.budget.version}` : "sem orçamento aprovado"})`}>
              <form method="get" className="mb-3 flex gap-2 text-sm"><select name="empresa" defaultValue={companyId} className="rounded border px-2 py-1">{companies.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select><input name="ano" type="number" defaultValue={year} className="w-24 rounded border px-2 py-1" /><button className="rounded bg-slate-800 px-3 text-white">Ver</button></form>
              <DataTable dense rows={bva.rows.map((r) => ({ ...r, id: r.account.id }))} columns={[{ key: "a", label: "Conta", render: (r) => `${r.account.code} ${r.account.name}` }, { key: "p", label: "Orçado", align: "right", render: (r) => formatMoney(r.planned) }, { key: "r", label: "Realizado", align: "right", render: (r) => formatMoney(r.actual) }, { key: "v", label: "Variação", align: "right", render: (r) => <span className={r.variance.isZero() ? "" : (r.account.type === "REVENUE") === r.variance.gt(0) ? "text-emerald-700" : "text-red-700"}>{formatMoney(r.variance)}</span> }, { key: "pc", label: "% realizado", align: "right", render: (r) => (r.pct ? `${r.pct.toFixed(1)}%` : "—") }]} />
            </Card>
          )}
        </div>
        {ctx.permissions.has("controlling.write") && (
          <Card title="Nova versão">
            <ActionForm action={createBudgetAction}>
              <Select name="companyId" label="Empresa" options={companies} required />
              <FormGrid cols={2}><Input name="year" type="number" label="Ano" defaultValue={String(year)} required /><Select name="kind" label="Tipo" options={[{ value: "BUDGET", label: "Orçamento" }, { value: "FORECAST", label: "Forecast" }]} /></FormGrid>
              <Input name="name" label="Nome" required />
              <Select name="basedOnId" label="Copiar linhas de" options={budgets.map((b) => ({ value: b.id, label: `${b.name} v${b.version}` }))} placeholder="—" />
              <SubmitButton>Criar</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
