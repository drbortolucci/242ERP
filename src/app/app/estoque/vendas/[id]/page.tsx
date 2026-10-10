import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card, DefinitionList, StatusBadge, Notice } from "@/components/ui/page";
import { DataTable, TotalRow } from "@/components/ui/table";
import { ActionButton, ActionForm, FormGrid, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pageAnyPerm } from "@/server/page-guard";
import { lookups, nameMap } from "@/modules/config/lookups";
import { formatCivil, todayIn, toCivil } from "@/lib/dates";
import { dec, formatMoney, formatQty } from "@/lib/money";
import { cancelOrderAction, confirmOrderAction, deliverOrderAction, saveOrderAction } from "../../actions";
import { productOptions, warehouseOptions } from "../../lookups";
import { OrderLines } from "../order-lines";

export default async function ProductOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  pageAnyPerm(ctx, "sales.goods", "inventory.read");
  const o = await ctx.db.productOrder.findFirst({ where: { id } });
  if (!o) notFound();
  const [lines, receivables, wh, term] = await Promise.all([
    ctx.db.productOrderLine.findMany({ where: { orderId: id } }), ctx.db.receivable.findMany({ where: { productOrderId: id }, orderBy: { dueDate: "asc" } }),
    ctx.db.warehouse.findFirst({ where: { id: o.warehouseId } }), o.paymentTermId ? ctx.db.paymentTerm.findFirst({ where: { id: o.paymentTermId } }) : null,
  ]);
  const [pn, cn] = await Promise.all([nameMap(ctx, "party", [o.partyId]), nameMap(ctx, "company", [o.companyId])]);
  const canSell = ctx.permissions.has("sales.goods");
  const showCost = ctx.permissions.has("cost.view") || ctx.permissions.has("margin.view");
  const today = todayIn(ctx.timezone);
  const margin = o.costAmount ? dec(o.totalAmount).minus(dec(o.freightAmount)).minus(dec(o.costAmount)) : null;
  const editing = o.status === "DRAFT" && canSell;
  const [companies, customers, whs, terms, products] = editing
    ? await Promise.all([lookups.companies(ctx), ctx.db.party.findMany({ where: { isCustomer: true, active: true }, orderBy: { name: "asc" } }), warehouseOptions(ctx), lookups.paymentTerms(ctx), productOptions(ctx)])
    : [[], [], [], [], []];
  return (
    <>
      <PageHeader title={`Pedido ${o.number}`} subtitle={<StatusBadge status={o.status} />} breadcrumbs={[{ label: "Estoque" }, { label: "Vendas de produtos", href: "/app/estoque/vendas" }, { label: o.number }]}
        actions={canSell && (
          <div className="flex flex-wrap gap-2">
            {o.status === "DRAFT" && <ActionButton action={confirmOrderAction} fields={{ id }} variant="primary">Confirmar e reservar</ActionButton>}
          </div>
        )} />
      <Notice>Pedido interno. A nota fiscal de mercadorias deve ser emitida pelo módulo fiscal (provedor homologado) — este documento não é nota fiscal.</Notice>
      <div className="mt-4 grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Itens">
            <DataTable rows={lines} columns={[
              { key: "d", label: "Produto", render: (l) => l.description }, { key: "q", label: "Qtd.", align: "right", render: (l) => formatQty(l.quantity, 2) },
              { key: "p", label: "Preço", align: "right", render: (l) => formatMoney(l.unitPrice) }, { key: "x", label: "Desconto", align: "right", render: (l) => formatMoney(l.discountAmount) },
              { key: "a", label: "Valor", align: "right", render: (l) => formatMoney(l.amount) },
              ...(showCost ? [{ key: "c", label: "Custo", align: "right" as const, render: (l: (typeof lines)[number]) => (l.costAmount ? formatMoney(l.costAmount) : "—") }] : []),
            ]} footer={<TotalRow cells={["Total", "", "", formatMoney(o.discountAmount), formatMoney(dec(o.productsAmount).minus(dec(o.discountAmount))), ...(showCost ? [o.costAmount ? formatMoney(o.costAmount) : "—"] : [])]} />} />
          </Card>
          {receivables.length > 0 && (
            <Card title="Contas a receber">
              <DataTable rows={receivables} rowHref={(r) => `/app/financeiro/titulos/receber/${r.id}`} columns={[
                { key: "number", label: "Título" }, { key: "p", label: "Parcela", render: (r) => `${r.installment}/${r.installments}` }, { key: "d", label: "Vencimento", render: (r) => formatCivil(r.dueDate) },
                { key: "a", label: "Valor", align: "right", render: (r) => formatMoney(r.amount) }, { key: "o", label: "Em aberto", align: "right", render: (r) => formatMoney(r.openAmount) }, { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> },
              ]} />
            </Card>
          )}
          {editing && (
            <Card title="Editar rascunho">
              <ActionForm action={saveOrderAction} noImplicitSubmit>
                <input type="hidden" name="id" value={o.id} />
                <FormGrid cols={2}><Select name="companyId" label="Empresa" options={companies} defaultValue={o.companyId} required /><Select name="partyId" label="Cliente" options={customers.map((c) => ({ value: c.id, label: c.tradeName || c.name }))} defaultValue={o.partyId} required /></FormGrid>
                <FormGrid cols={2}><Select name="warehouseId" label="Depósito de saída" options={whs} defaultValue={o.warehouseId} required /><Input name="orderDate" type="date" label="Data" defaultValue={toCivil(o.orderDate)} required /></FormGrid>
                <FormGrid cols={3}><Select name="paymentTermId" label="Condição" options={terms} placeholder="Padrão" defaultValue={o.paymentTermId ?? ""} /><Input name="freightAmount" label="Frete cobrado" defaultValue={o.freightAmount.toString()} /><Input name="customerPo" label="Pedido do cliente" defaultValue={o.customerPo ?? ""} /></FormGrid>
                <OrderLines products={products} initial={lines.map((l) => ({ productId: l.productId, quantity: l.quantity.toString(), price: l.unitPrice.toString(), discount: l.discountAmount.toString() }))} />
                <Textarea name="notes" label="Observações" defaultValue={o.notes ?? ""} />
                <SubmitButton>Salvar rascunho</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card title="Resumo">
            <DefinitionList items={[
              { label: "Cliente", value: <Link className="text-brand-700" href={`/app/cadastros/clientes/${o.partyId}`}>{pn.get(o.partyId)}</Link> }, { label: "Empresa", value: cn.get(o.companyId) },
              { label: "Depósito", value: wh ? `${wh.code} — ${wh.name}` : "—" }, { label: "Data", value: formatCivil(o.orderDate) }, { label: "Condição", value: term?.name ?? "Padrão" },
              { label: "Produtos", value: formatMoney(o.productsAmount) }, { label: "Descontos", value: formatMoney(o.discountAmount) }, { label: "Frete", value: formatMoney(o.freightAmount) },
              { label: "Total", value: <b>{formatMoney(o.totalAmount)}</b> },
              ...(showCost && margin ? [{ label: "Margem bruta (sem frete)", value: `${formatMoney(margin)}` }] : []),
              ...(o.deliveredAt ? [{ label: "Entregue em", value: formatCivil(o.deliveredAt) }] : []),
              ...(o.cancelReason ? [{ label: "Motivo do cancelamento", value: o.cancelReason }] : []),
            ]} />
          </Card>
          {canSell && o.status === "CONFIRMED" && (
            <Card title="Registrar entrega">
              <ActionForm action={deliverOrderAction}>
                <input type="hidden" name="id" value={o.id} />
                <Input name="date" type="date" label="Data da entrega" defaultValue={today} required />
                <SubmitButton confirm="Baixar o estoque e gerar as contas a receber?">Entregar</SubmitButton>
              </ActionForm>
            </Card>
          )}
          {canSell && o.status !== "CANCELED" && (
            <Card title="Cancelar pedido">
              <ActionForm action={cancelOrderAction}>
                <input type="hidden" name="id" value={o.id} />
                <input type="hidden" name="date" value={today} />
                <Input name="reason" label="Motivo" required />
                <SubmitButton variant="danger" confirm={o.status === "DELIVERED" ? "Cancelar o pedido entregue? O estoque retorna e os títulos sem recebimento são cancelados." : "Cancelar o pedido?"}>Cancelar pedido</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
