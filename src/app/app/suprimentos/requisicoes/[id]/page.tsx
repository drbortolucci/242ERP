import Link from "@/components/ui/access-link";
import { notFound } from "next/navigation";
import { PageHeader, Card, DefinitionList, StatusBadge, Notice, Badge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionButton, ActionForm, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pageAnyPerm } from "@/server/page-guard";
import { ApprovalPanel } from "@/components/approval-panel";
import { lookups, nameMap } from "@/modules/config/lookups";
import { compareQuotations } from "@/domain/three-way-match";
import { formatCivil, todayIn } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { PO_KINDS } from "../../constants";
import { submitRequisitionAction, addQuotationAction, createPoAction } from "../../actions";

export default async function RequisitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  pageAnyPerm(ctx, "purchase.request", "purchase.write");
  const r = await ctx.db.purchaseRequisition.findFirst({ where: { id } });
  if (!r) notFound();
  const [lines, quotes, suppliers, po] = await Promise.all([ctx.db.requisitionLine.findMany({ where: { requisitionId: id } }), ctx.db.quotation.findMany({ where: { requisitionId: id }, orderBy: { totalAmount: "asc" } }), lookups.suppliers(ctx), ctx.db.purchaseOrder.findFirst({ where: { requisitionId: id, status: { not: "CANCELED" } } })]);
  const qlines = await ctx.db.quotationLine.findMany({ where: { quotationId: { in: quotes.map((q) => q.id) } } });
  const sn = await nameMap(ctx, "party", quotes.map((q) => q.supplierPartyId));
  const cmp = compareQuotations(quotes.map((q) => ({ id: q.id, total: q.totalAmount, deliveryDays: q.deliveryDays, lines: qlines.filter((l) => l.quotationId === q.id).map((l) => ({ lineId: l.requisitionLineId, unitPrice: l.unitPrice })) })));
  const b = r.budgetCheck as { scope: string; budget: string; used: string; available: string; requested: string; ok: boolean; hasBudget: boolean } | null;
  const canBuy = ctx.permissions.has("purchase.write");
  return (
    <>
      <PageHeader title={`${r.number} — ${r.description}`} subtitle={<StatusBadge status={r.status} />} breadcrumbs={[{ label: "Requisições", href: "/app/suprimentos/requisicoes" }, { label: r.number }]}
        actions={r.status === "DRAFT" && <ActionButton action={submitRequisitionAction} fields={{ id }} variant="primary">Enviar</ActionButton>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Itens"><DataTable dense rows={lines} columns={[{ key: "kind", label: "Tipo" }, { key: "description", label: "Descrição" }, { key: "q", label: "Qtd.", align: "right", render: (l) => `${formatQty(l.quantity)} ${l.unit}` }, { key: "p", label: "Preço est.", align: "right", render: (l) => formatMoney(l.estimatedUnitPrice) }]} /></Card>
          <Card title="Mapa comparativo de cotações">
            {quotes.length === 0 ? <p className="text-sm text-slate-500">Nenhuma cotação.</p> : (
              <div className="overflow-x-auto"><table className="min-w-full text-sm">
                <thead><tr className="text-left text-xs text-slate-500"><th className="p-1">Item</th>{quotes.map((q) => <th key={q.id} className="p-1">{sn.get(q.supplierPartyId)}</th>)}</tr></thead>
                <tbody>
                  {lines.map((l) => <tr key={l.id} className="border-t"><td className="p-1">{l.description}</td>{quotes.map((q) => { const ql = qlines.find((x) => x.quotationId === q.id && x.requisitionLineId === l.id); return <td key={q.id} className={`p-1 tabular-nums ${cmp.bestByLine[l.id] === q.id ? "font-semibold text-emerald-700" : ""}`}>{ql ? formatMoney(ql.unitPrice) : "—"}</td>; })}</tr>)}
                  <tr className="border-t font-medium"><td className="p-1">Total</td>{quotes.map((q) => <td key={q.id} className="p-1 tabular-nums">{formatMoney(q.totalAmount)} {cmp.cheapestId === q.id && <Badge tone="green">menor preço</Badge>}</td>)}</tr>
                  <tr className="border-t"><td className="p-1">Prazo (dias)</td>{quotes.map((q) => <td key={q.id} className="p-1">{q.deliveryDays ?? "—"} {cmp.fastestId === q.id && <Badge tone="blue">mais rápido</Badge>}</td>)}</tr>
                  <tr className="border-t"><td className="p-1">Condições</td>{quotes.map((q) => <td key={q.id} className="p-1 text-xs">{q.paymentTerms ?? "—"}</td>)}</tr>
                  <tr className="border-t"><td className="p-1">Validade</td>{quotes.map((q) => <td key={q.id} className="p-1 text-xs">{formatCivil(q.validUntil)}</td>)}</tr>
                  {canBuy && !po && <tr className="border-t"><td className="p-1">Decisão</td>{quotes.map((q) => <td key={q.id} className="p-1">
                    <ActionForm action={createPoAction}><input type="hidden" name="companyId" value={r.companyId} /><input type="hidden" name="supplierPartyId" value={q.supplierPartyId} /><input type="hidden" name="quotationId" value={q.id} /><input type="hidden" name="orderDate" value={todayIn(ctx.timezone)} /><input type="hidden" name="advanceAmount" value="0" /><input type="hidden" name="tolerancePct" value="0" />
                      <Select name="kind" options={PO_KINDS} aria-label="Tipo de contratação" />
                      <SubmitButton variant="secondary">Gerar pedido</SubmitButton></ActionForm></td>)}</tr>}
                </tbody>
              </table></div>
            )}
            {po && <p className="mt-3 text-sm">Pedido gerado: <Link className="text-brand-700 underline" href={`/app/suprimentos/pedidos/${po.id}`}>{po.number}</Link></p>}
          </Card>
          {canBuy && ["APPROVED", "QUOTING"].includes(r.status) && (
            <Card title="Registrar cotação de fornecedor">
              <ActionForm action={addQuotationAction} resetOnSuccess>
                <input type="hidden" name="requisitionId" value={id} />
                <FormGrid cols={3}><Select name="supplierPartyId" label="Fornecedor" options={suppliers} required /><Input name="deliveryDays" type="number" label="Prazo (dias)" /><Input name="validUntil" type="date" label="Validade" /></FormGrid>
                <Input name="paymentTerms" label="Condições de pagamento" />
                {lines.map((l) => <div key={l.id} className="flex items-end gap-2"><input type="hidden" name="lineId[]" value={l.id} /><Input name="unitPrice[]" label={`Preço unitário — ${l.description} (${formatQty(l.quantity)} ${l.unit})`} required /></div>)}
                <SubmitButton variant="secondary">Registrar cotação</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card title="Verificação de orçamento">
            {b ? <><DefinitionList items={[{ label: "Referência", value: b.scope }, { label: "Orçado", value: formatMoney(b.budget) }, { label: "Comprometido", value: formatMoney(b.used) }, { label: "Disponível", value: formatMoney(b.available) }, { label: "Solicitado", value: formatMoney(b.requested) }]} /><div className="mt-2"><Notice tone={!b.hasBudget ? "warn" : b.ok ? "success" : "error"}>{!b.hasBudget ? "Sem orçamento cadastrado para a referência." : b.ok ? "Dentro do orçamento." : "Acima do orçamento disponível — a aprovação será alertada."}</Notice></div></> : "—"}
          </Card>
          <ApprovalPanel ctx={ctx} entity="PurchaseRequisition" entityId={id} back={`/app/suprimentos/requisicoes/${id}`} />
        </div>
      </div>
    </>
  );
}
