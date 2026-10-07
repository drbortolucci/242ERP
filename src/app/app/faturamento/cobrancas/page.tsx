import { PageHeader, StatusBadge, Badge } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { nameMap } from "@/modules/config/lookups";
import { pageQuery, sp, textSearch, type SearchParams } from "@/lib/query";
import { formatCivil } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { FISCAL } from "../constants";


export const metadata = { title: "Documentos de cobrança" };
export default async function BillingDocsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pagePerm(ctx, "billing.read");
  const q = pageQuery(s);
  const status = sp(s, "status");
  const where = { AND: [textSearch(q.q, ["number", "customerPo"]), status ? { status } : {}] };
  const [rows, total] = await Promise.all([ctx.db.billingDocument.findMany({ where, orderBy: { createdAt: "desc" }, skip: q.skip, take: q.take }), ctx.db.billingDocument.count({ where })]);
  const pn = await nameMap(ctx, "party", rows.map((r) => r.partyId));
  return (
    <>
      <PageHeader title="Documentos de cobrança" subtitle="Documento interno de cobrança — a NFS-e é emitida pelo provedor fiscal" breadcrumbs={[{ label: "Faturamento" }, { label: "Documentos de cobrança" }]} />
      <Toolbar base="/app/faturamento/cobrancas" params={s} filters={[{ name: "status", label: "Situação", options: [{ value: "ISSUED", label: "Emitido" }, { value: "CANCELED", label: "Cancelado" }] }]} />
      <DataTable rows={rows} rowHref={(r) => `/app/faturamento/cobrancas/${r.id}`} columns={[
        { key: "number", label: "Número" }, { key: "p", label: "Cliente", render: (r) => pn.get(r.partyId) }, { key: "i", label: "Emissão", render: (r) => formatCivil(r.issueDate) },
        { key: "g", label: "Bruto", align: "right", render: (r) => formatMoney(r.grossAmount) }, { key: "w", label: "Retenções", align: "right", render: (r) => formatMoney(r.withholdingAmount) }, { key: "n", label: "Líquido", align: "right", render: (r) => formatMoney(r.netAmount) },
        { key: "f", label: "NFS-e", render: (r) => { const [l, t] = (FISCAL[r.fiscalStatus] ?? [r.fiscalStatus, "slate"]) as [string, "slate"]; return <Badge tone={t}>{l}</Badge>; } }, { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> },
      ]} />
      <Pagination base="/app/faturamento/cobrancas" params={s} page={q.page} pageSize={q.pageSize} total={total} />
    </>
  );
}
