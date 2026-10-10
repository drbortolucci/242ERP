import Link from "@/components/ui/access-link";
import { PageHeader, Card } from "@/components/ui/page";
import { DataTable, Pagination } from "@/components/ui/table";
import { ActionForm, FormGrid, Select, SubmitButton, Textarea, Input } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { lookups, nameMap, userNameMap } from "@/modules/config/lookups";
import { pageQuery, sp, type SearchParams } from "@/lib/query";
import { addMonths, civil, monthStart, todayIn, toCivil } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { syncLedgerAction, payrollAction } from "../actions";
import { Filters } from "../filters";

const SRC: Record<string, string> = { TIME_COST: "Horas", LABOR_ABSORPTION: "Absorção de pessoal", SUPPLIER_INVOICE: "Fornecedor", EXPENSE: "Despesa", REVENUE_RECOGNITION: "Receita", DEDUCTION: "Dedução", PAYROLL_IMPORT: "Folha", ALLOCATION: "Rateio", REVERSAL: "Estorno", MANUAL_ADJUSTMENT: "Título/financeiro/comissão" };
function originHref(e: { sourceType: string; sourceId: string | null; projectId: string | null }) {
  if (e.sourceType === "SUPPLIER_INVOICE") return "/app/suprimentos/notas";
  if (e.sourceType === "EXPENSE" && e.sourceId) return `/app/despesas/${e.sourceId}`;
  if (e.sourceType === "ALLOCATION") return "/app/controladoria/rateios";
  if (e.projectId) return `/app/controladoria/pl/${e.projectId}`;
  return null;
}

export const metadata = { title: "Razão gerencial" };
export default async function LedgerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pagePerm(ctx, "controlling.read");
  const q = pageQuery(s);
  const cur = monthStart(todayIn(ctx.timezone));
  const from = sp(s, "de") ? `${sp(s, "de")!.slice(0, 7)}-01` : addMonths(cur, -1);
  const to = sp(s, "ate") ? `${sp(s, "ate")!.slice(0, 7)}-01` : cur;
  const companyId = sp(s, "empresa");
  const accountId = sp(s, "conta");
  const where = { competence: { gte: civil(from), lte: civil(to) }, ...(companyId ? { companyId } : {}), ...(accountId ? { accountId } : {}), ...(sp(s, "projeto") ? { projectId: sp(s, "projeto") } : {}) };
  const [rows, total, agg, companies, accounts] = await Promise.all([
    ctx.db.managerialEntry.findMany({ where, orderBy: [{ competence: "desc" }, { createdAt: "desc" }], skip: q.skip, take: q.take }), ctx.db.managerialEntry.count({ where }),
    ctx.db.managerialEntry.aggregate({ where, _sum: { amount: true } }), lookups.companies(ctx), ctx.db.managerialAccount.findMany({ orderBy: { code: "asc" } }),
  ]);
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const [pn, cc, users] = await Promise.all([nameMap(ctx, "project", rows.map((r) => r.projectId)), nameMap(ctx, "costCenter", rows.map((r) => r.costCenterId)), userNameMap(rows.map((r) => r.createdById))]);
  const canWrite = ctx.permissions.has("controlling.write");
  return (
    <>
      <PageHeader title="Razão gerencial" breadcrumbs={[{ label: "Controladoria" }, { label: "Razão" }]} actions={companyId && <a className="rounded border px-3 py-1.5 text-sm" href={`/api/razao?empresa=${companyId}&mes=${to}`}>Exportar CSV ({to.slice(5, 7)}/{to.slice(0, 4)})</a>} />
      <Filters from={from} to={to} companyId={companyId} companies={companies} extra={<label className="flex flex-col text-xs">Conta<select name="conta" defaultValue={accountId ?? ""} className="rounded border px-2 py-1 text-sm"><option value="">Todas</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></label>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <DataTable dense rows={rows} columns={[
            { key: "c", label: "Competência", render: (r) => toCivil(r.competence).slice(0, 7).split("-").reverse().join("/") }, { key: "a", label: "Conta", render: (r) => `${acc.get(r.accountId)?.code} ${acc.get(r.accountId)?.name}` },
            { key: "d", label: "Histórico", render: (r) => r.description }, { key: "p", label: "Projeto / CC", render: (r) => pn.get(r.projectId ?? "") ?? cc.get(r.costCenterId ?? "") ?? "—" },
            { key: "o", label: "Origem", render: (r) => { const h = originHref(r); const l = SRC[r.sourceType] ?? r.sourceType; return h ? <Link className="text-brand-700 underline" href={h}>{l}</Link> : l; } },
            { key: "v", label: "Valor", align: "right", render: (r) => <span className={Number(r.amount) < 0 ? "text-red-700" : ""}>{formatMoney(r.amount)}</span> }, { key: "u", label: "Por", render: (r) => users.get(r.createdById ?? "") ?? "—" },
          ]} />
          <p className="mt-2 text-right text-sm">Soma do filtro: <b>{formatMoney(agg._sum.amount ?? 0)}</b> ({total} lançamentos)</p>
          <Pagination base="/app/controladoria/razao" params={s} page={q.page} pageSize={q.pageSize} total={total} />
        </div>
        {canWrite && (
          <div className="space-y-6">
            <Card title="Sincronizar competência">
              <ActionForm action={syncLedgerAction}>
                <Select name="companyId" label="Empresa" options={companies} required />
                <Input name="month" type="date" label="Competência (qualquer dia do mês)" defaultValue={cur} required />
                <SubmitButton>Sincronizar razão</SubmitButton>
                <p className="text-xs text-slate-500">Idempotente: lança somente o que falta e estorna origens canceladas. Períodos fechados não são alterados.</p>
              </ActionForm>
            </Card>
            <Card title="Importar folha (consolidada)">
              <ActionForm action={payrollAction} resetOnSuccess>
                <FormGrid cols={2}><Select name="companyId" label="Empresa" options={companies} required /><Input name="month" type="date" label="Competência" defaultValue={addMonths(cur, -1)} required /></FormGrid>
                <Textarea name="content" label="Linhas (centro de custo;descrição;valor)" rows={5} placeholder={"OP-01;Salários e encargos;85.000,00"} required />
                <SubmitButton variant="secondary">Importar</SubmitButton>
              </ActionForm>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
