import { PageHeader, StatusBadge } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { nameMap } from "@/modules/config/lookups";
import { pageQuery, sp, textSearch, type SearchParams } from "@/lib/query";
import { formatCivil } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { statusLabel } from "@/lib/labels";

export const metadata = { title: "Medições" };
export default async function MeasurementsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pagePerm(ctx, "billing.read");
  const q = pageQuery(s);
  const status = sp(s, "status");
  const where = { AND: [textSearch(q.q, ["number", "notes"]), status ? { status } : {}] };
  const [rows, total] = await Promise.all([ctx.db.measurement.findMany({ where, orderBy: { createdAt: "desc" }, skip: q.skip, take: q.take }), ctx.db.measurement.count({ where })]);
  const [pn, cn] = await Promise.all([nameMap(ctx, "party", rows.map((r) => r.partyId)), nameMap(ctx, "contract", rows.map((r) => r.contractId))]);
  return (
    <>
      <PageHeader title="Medições" breadcrumbs={[{ label: "Faturamento" }, { label: "Medições" }]} />
      <Toolbar base="/app/faturamento/medicoes" params={s} filters={[{ name: "status", label: "Situação", options: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "CLIENT_PENDING", "CLIENT_APPROVED", "PARTIALLY_INVOICED", "INVOICED", "CANCELED"].map((v) => ({ value: v, label: statusLabel(v) })) }]} />
      <DataTable rows={rows} rowHref={(r) => `/app/faturamento/medicoes/${r.id}`} columns={[
        { key: "number", label: "Número" }, { key: "c", label: "Contrato", render: (r) => cn.get(r.contractId) }, { key: "p", label: "Cliente", render: (r) => pn.get(r.partyId) },
        { key: "per", label: "Período", render: (r) => `${formatCivil(r.periodStart)} a ${formatCivil(r.periodEnd)}` }, { key: "comp", label: "Competência", render: (r) => formatCivil(r.competence).slice(3) },
        { key: "t", label: "Total", align: "right", render: (r) => formatMoney(r.totalAmount) }, { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> },
      ]} />
      <Pagination base="/app/faturamento/medicoes" params={s} page={q.page} pageSize={q.pageSize} total={total} />
    </>
  );
}
