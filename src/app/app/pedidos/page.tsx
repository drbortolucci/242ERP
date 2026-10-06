import { PageHeader, StatusBadge } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { nameMap } from "@/modules/config/lookups";
import { pageQuery, sp, textSearch, type SearchParams } from "@/lib/query";
import { formatMoney, sum } from "@/lib/money";
import { formatCivil } from "@/lib/dates";

export const metadata = { title: "Pedidos de venda" };
export default async function OrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pagePerm(ctx, "contract.read");
  const q = pageQuery(s);
  const status = sp(s, "status");
  const where = { AND: [textSearch(q.q, ["number", "customerPo"]), status ? { status } : {}] };
  const [rows, total, open] = await Promise.all([ctx.db.salesOrder.findMany({ where, orderBy: { orderDate: "desc" }, skip: q.skip, take: q.take }), ctx.db.salesOrder.count({ where }), ctx.db.salesOrder.findMany({ where: { status: "OPEN" } })]);
  const parties = await nameMap(ctx, "party", rows.map((r) => r.partyId));
  return (
    <>
      <PageHeader title="Pedidos de venda (carteira)" subtitle={`Carteira sem contrato: ${open.length} pedido(s), ${formatMoney(sum(open.map((o) => o.totalAmount)))}`} breadcrumbs={[{ label: "Comercial" }, { label: "Pedidos" }]} />
      <Toolbar base="/app/pedidos" params={s} filters={[{ name: "status", label: "Situação", options: [{ value: "OPEN", label: "Aberto (sem contrato)" }, { value: "CONTRACTED", label: "Contratado" }, { value: "CANCELED", label: "Cancelado" }] }]} />
      <DataTable rows={rows} rowHref={(o) => `/app/pedidos/${o.id}`} columns={[{ key: "number", label: "Número" }, { key: "party", label: "Cliente", render: (o) => parties.get(o.partyId) }, { key: "orderDate", label: "Data", render: (o) => formatCivil(o.orderDate) }, { key: "customerPo", label: "OC cliente", render: (o) => o.customerPo ?? "—" }, { key: "totalAmount", label: "Valor", align: "right", render: (o) => formatMoney(o.totalAmount) }, { key: "status", label: "Situação", render: (o) => <StatusBadge status={o.status} /> }]} />
      <Pagination base="/app/pedidos" params={s} page={q.page} pageSize={q.pageSize} total={total} />
    </>
  );
}
