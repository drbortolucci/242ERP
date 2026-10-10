import { PageHeader, Card, StatusBadge, Stat, Grid } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { ActionForm, FormGrid, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pageAnyPerm } from "@/server/page-guard";
import { lookups, nameMap } from "@/modules/config/lookups";
import { pageQuery, sp, textSearch, type SearchParams } from "@/lib/query";
import { formatCivil, todayIn } from "@/lib/dates";
import { formatMoney, sum } from "@/lib/money";
import { statusLabel } from "@/lib/labels";
import { saveOrderAction } from "../actions";
import { productOptions, warehouseOptions } from "../lookups";
import { OrderLines } from "./order-lines";

export const metadata = { title: "Vendas de produtos" };
export default async function ProductOrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pageAnyPerm(ctx, "sales.goods", "inventory.read");
  const q = pageQuery(s);
  const status = sp(s, "status");
  const where = { AND: [textSearch(q.q, ["number", "customerPo", "notes"]), status ? { status } : {}] };
  const [rows, total, companies, customers, whs, terms, products, open] = await Promise.all([
    ctx.db.productOrder.findMany({ where, orderBy: { createdAt: "desc" }, skip: q.skip, take: q.take }), ctx.db.productOrder.count({ where }),
    lookups.companies(ctx), ctx.db.party.findMany({ where: { isCustomer: true, active: true }, orderBy: { name: "asc" } }), warehouseOptions(ctx), lookups.paymentTerms(ctx), productOptions(ctx),
    ctx.db.productOrder.findMany({ where: { status: "CONFIRMED" } }),
  ]);
  const pn = await nameMap(ctx, "party", rows.map((r) => r.partyId));
  return (
    <>
      <PageHeader title="Pedidos de venda de produtos" subtitle="Rascunho → confirmado (reserva) → entregue (baixa de estoque e contas a receber)" breadcrumbs={[{ label: "Estoque" }, { label: "Vendas de produtos" }]} />
      <Grid cols={2}>
        <Stat label="Confirmados aguardando entrega" value={open.length} href="/app/estoque/vendas?status=CONFIRMED" />
        <Stat label="Valor a entregar" value={formatMoney(sum(open.map((o) => o.totalAmount)))} />
      </Grid>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Toolbar base="/app/estoque/vendas" params={s} filters={[{ name: "status", label: "Situação", options: ["DRAFT", "CONFIRMED", "DELIVERED", "CANCELED"].map((v) => ({ value: v, label: statusLabel(v) })) }]} />
          <DataTable rows={rows} rowHref={(r) => `/app/estoque/vendas/${r.id}`} empty="Nenhum pedido." columns={[
            { key: "number", label: "Número" }, { key: "c", label: "Cliente", render: (r) => pn.get(r.partyId) }, { key: "d", label: "Data", render: (r) => formatCivil(r.orderDate) },
            { key: "t", label: "Total", align: "right", render: (r) => formatMoney(r.totalAmount) }, { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> },
          ]} />
          <Pagination base="/app/estoque/vendas" params={s} page={q.page} pageSize={q.pageSize} total={total} />
        </div>
        {ctx.permissions.has("sales.goods") && (
          <Card title="Novo pedido">
            <ActionForm action={saveOrderAction} noImplicitSubmit>
              <Select name="companyId" label="Empresa" options={companies} required />
              <Select name="partyId" label="Cliente" options={customers.map((c) => ({ value: c.id, label: c.tradeName || c.name }))} required />
              <FormGrid cols={2}><Select name="warehouseId" label="Depósito de saída" options={whs} required /><Input name="orderDate" type="date" label="Data" defaultValue={todayIn(ctx.timezone)} required /></FormGrid>
              <FormGrid cols={3}><Select name="paymentTermId" label="Condição" options={terms} placeholder="Padrão" /><Input name="freightAmount" label="Frete cobrado" defaultValue="0" /><Input name="customerPo" label="Pedido do cliente" /></FormGrid>
              <OrderLines products={products} />
              <Textarea name="notes" label="Observações" />
              <SubmitButton>Criar pedido</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
