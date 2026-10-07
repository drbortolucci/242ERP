import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card, DefinitionList, StatusBadge, Notice, Badge } from "@/components/ui/page";
import { DataTable, TotalRow } from "@/components/ui/table";
import { ActionButton, ActionForm, FormGrid, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pageAnyPerm } from "@/server/page-guard";
import { ApprovalPanel } from "@/components/approval-panel";
import { nameMap, userNameMap } from "@/modules/config/lookups";
import { threeWayMatch } from "@/domain/three-way-match";
import { formatCivil, todayIn, monthStart } from "@/lib/dates";
import { dec, formatMoney, formatQty, sum } from "@/lib/money";
import { PO_KINDS, RECEIPT_KINDS, poKindLabel } from "../../constants";
import { submitPoAction, cancelPoAction, closePoAction, receiptAction, supplierInvoiceAction, evaluateAction } from "../../actions";

const SCORE = ["1", "2", "3", "4", "5"].map((v) => ({ value: v, label: v }));

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  pageAnyPerm(ctx, "purchase.write", "purchase.approve", "purchase.receive");
  const po = await ctx.db.purchaseOrder.findFirst({ where: { id } });
  if (!po) notFound();
  const [lines, receipts, invoices, assets, evals] = await Promise.all([
    ctx.db.purchaseOrderLine.findMany({ where: { purchaseOrderId: id } }),
    ctx.db.goodsReceipt.findMany({ where: { purchaseOrderId: id }, orderBy: { date: "desc" } }),
    ctx.db.supplierInvoice.findMany({ where: { purchaseOrderId: id }, orderBy: { issueDate: "desc" } }),
    ctx.db.asset.findMany({ where: { purchaseOrderId: id } }),
    ctx.db.supplierEvaluation.findMany({ where: { purchaseOrderId: id } }),
  ]);
  const rlines = await ctx.db.goodsReceiptLine.findMany({ where: { receiptId: { in: receipts.map((r) => r.id) } } });
  const payables = await ctx.db.payable.findMany({ where: { OR: [{ sourceType: "SUPPLIER_ADVANCE", sourceId: id }, { sourceType: "SUPPLIER_INVOICE", sourceId: { in: invoices.map((i) => i.id) } }] }, orderBy: { dueDate: "asc" } });
  const [sn, pn, cc, acc, users] = await Promise.all([
    nameMap(ctx, "party", [po.supplierPartyId]), nameMap(ctx, "project", [po.projectId]), nameMap(ctx, "costCenter", [po.costCenterId]), nameMap(ctx, "managerialAccount", [po.accountId]),
    userNameMap([po.createdById, po.approvedById, ...receipts.map((r) => r.acceptedById)]),
  ]);
  const received = sum(lines.map((l) => l.receivedAmount));
  const invoiced = sum(lines.map((l) => l.invoicedAmount));
  const preview = threeWayMatch({ poTotal: po.totalAmount, received, alreadyInvoiced: invoiced, invoiceAmount: 0.01, tolerancePct: po.tolerancePct });
  const open = ["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(po.status);
  const can = (p: string) => ctx.permissions.has(p);
  const today = todayIn(ctx.timezone);
  const back = `/app/suprimentos/pedidos/${id}`;
  return (
    <>
      <PageHeader title={`${po.number} — ${sn.get(po.supplierPartyId)}`} subtitle={<span className="flex gap-2"><StatusBadge status={po.status} /><Badge tone="violet">{poKindLabel(po.kind)}</Badge></span>}
        breadcrumbs={[{ label: "Pedidos de compra", href: "/app/suprimentos/pedidos" }, { label: po.number }]}
        actions={po.status === "DRAFT" && can("purchase.write") && <ActionButton action={submitPoAction} fields={{ id }} variant="primary">Enviar para aprovação</ActionButton>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Itens — pedido × recebido/aceito × faturado (3 vias)">
            <DataTable dense rows={lines} columns={[
              { key: "d", label: "Descrição", render: (l) => <>{l.description} <span className="text-xs text-slate-500">({l.kind})</span></> },
              { key: "q", label: "Qtd.", align: "right", render: (l) => formatQty(l.quantity) }, { key: "u", label: "Unitário", align: "right", render: (l) => formatMoney(l.unitPrice) },
              { key: "a", label: "Pedido", align: "right", render: (l) => formatMoney(l.amount) }, { key: "rq", label: "Qtd. recebida", align: "right", render: (l) => formatQty(l.receivedQty) },
              { key: "ra", label: "Recebido", align: "right", render: (l) => formatMoney(l.receivedAmount) }, { key: "ia", label: "Faturado", align: "right", render: (l) => formatMoney(l.invoicedAmount) },
            ]} footer={<TotalRow cells={["Total", "", "", formatMoney(po.totalAmount), "", formatMoney(received), formatMoney(invoiced)]} />} />
          </Card>

          <Card title="Recebimentos e aceites">
            <DataTable dense rows={receipts} empty="Nenhum recebimento." columns={[
              { key: "n", label: "Número" }, { key: "d", label: "Data", render: (r) => formatCivil(r.date) }, { key: "k", label: "Tipo", render: (r) => RECEIPT_KINDS.find((k) => k.value === r.kind)?.label },
              { key: "v", label: "Valor", align: "right", render: (r) => formatMoney(sum(rlines.filter((x) => x.receiptId === r.id).map((x) => x.amount))) },
              { key: "u", label: "Aceito por", render: (r) => users.get(r.acceptedById) }, { key: "o", label: "Observação", render: (r) => r.notes ?? "" },
            ]} />
            {open && can("purchase.receive") && (
              <div className="mt-4 border-t pt-4">
                <ActionForm action={receiptAction} resetOnSuccess>
                  <input type="hidden" name="purchaseOrderId" value={id} />
                  <FormGrid cols={3}><Input name="date" type="date" label="Data" defaultValue={today} required /><Select name="kind" label="Tipo" options={RECEIPT_KINDS} /><Input name="notes" label="Observação / evidência do aceite" /></FormGrid>
                  {lines.map((l) => <div key={l.id}><input type="hidden" name="lineId[]" value={l.id} /><Input name="quantity[]" label={`Qtd. — ${l.description} (saldo ${formatQty(dec(l.quantity).minus(dec(l.receivedQty)))})`} defaultValue="0" /></div>)}
                  <SubmitButton variant="secondary">Registrar recebimento/aceite</SubmitButton>
                </ActionForm>
              </div>
            )}
          </Card>

          <Card title="Documentos de cobrança do fornecedor">
            <DataTable dense rows={invoices} empty="Nenhum documento." columns={[
              { key: "number", label: "Número" }, { key: "i", label: "Emissão", render: (r) => formatCivil(r.issueDate) }, { key: "v", label: "Vencimento", render: (r) => formatCivil(r.dueDate) },
              { key: "a", label: "Valor", align: "right", render: (r) => formatMoney(r.amount) }, { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> },
              { key: "n", label: "Conferência", render: (r) => r.divergenceNote ? <span className="text-xs text-amber-800">{r.divergenceNote}</span> : <span className="text-xs text-emerald-700">conferido</span> },
            ]} />
            {open && (can("purchase.write") || can("finance.write")) && (
              <div className="mt-4 border-t pt-4">
                <p className="mb-2 text-xs text-slate-500">Faturável agora (recebido − faturado): <b>{formatMoney(preview.billable)}</b> · Saldo do pedido: <b>{formatMoney(preview.poBalance)}</b> · Tolerância: {formatQty(po.tolerancePct)}%</p>
                <ActionForm action={supplierInvoiceAction} resetOnSuccess>
                  <input type="hidden" name="purchaseOrderId" value={id} />
                  <FormGrid cols={3}><Input name="number" label="Número do documento" required /><Input name="amount" label="Valor" required /><Input name="competence" type="date" label="Competência" defaultValue={monthStart(today)} required /></FormGrid>
                  <FormGrid cols={2}><Input name="issueDate" type="date" label="Emissão" defaultValue={today} required /><Input name="dueDate" type="date" label="Vencimento" required /></FormGrid>
                  <SubmitButton variant="secondary">Registrar e conferir (3 vias)</SubmitButton>
                </ActionForm>
              </div>
            )}
          </Card>

          <Card title="Contas a pagar vinculadas">
            <DataTable dense rows={payables} empty="Nenhuma conta a pagar." columns={[
              { key: "number", label: "Número" }, { key: "t", label: "Origem", render: (p) => p.sourceType === "SUPPLIER_ADVANCE" ? "Adiantamento" : "Documento do fornecedor" },
              { key: "d", label: "Vencimento", render: (p) => formatCivil(p.dueDate) }, { key: "a", label: "Valor", align: "right", render: (p) => formatMoney(p.amount) },
              { key: "o", label: "Em aberto", align: "right", render: (p) => formatMoney(p.openAmount) }, { key: "s", label: "Situação", render: (p) => <StatusBadge status={p.status} /> },
            ]} />
            <p className="mt-2 text-xs text-slate-500">Aprovação financeira e pagamento são executados no módulo Financeiro (Etapa 6).</p>
          </Card>

          {assets.length > 0 && (
            <Card title="Ativos, licenças e materiais gerados">
              <DataTable dense rows={assets} columns={[{ key: "name", label: "Nome" }, { key: "kind", label: "Tipo" }, { key: "q", label: "Qtd.", align: "right", render: (a) => formatQty(a.quantity) }, { key: "r", label: "Renovação", render: (a) => formatCivil(a.renewalDate) }, { key: "s", label: "Situação", render: (a) => <StatusBadge status={a.status} /> }]} />
              <Link href="/app/suprimentos/ativos" className="mt-2 inline-block text-sm text-brand-700 underline">Gerenciar ativos</Link>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Dados do pedido">
            <DefinitionList items={[
              { label: "Fornecedor", value: <Link className="text-brand-700 underline" href={`/app/cadastros/fornecedores/${po.supplierPartyId}`}>{sn.get(po.supplierPartyId)}</Link> },
              { label: "Tipo", value: PO_KINDS.find((k) => k.value === po.kind)?.label },
              { label: "Data", value: formatCivil(po.orderDate) }, { label: "Vigência", value: po.startDate ? `${formatCivil(po.startDate)} a ${formatCivil(po.endDate)}` : "—" },
              { label: "Projeto", value: po.projectId ? <Link className="text-brand-700 underline" href={`/app/projetos/${po.projectId}`}>{pn.get(po.projectId)}</Link> : "—" },
              { label: "Centro de custo", value: cc.get(po.costCenterId ?? "") ?? "—" }, { label: "Conta gerencial", value: acc.get(po.accountId ?? "") ?? "—" },
              { label: "Total", value: formatMoney(po.totalAmount) }, { label: "Adiantamento", value: formatMoney(po.advanceAmount) },
              { label: "Requisição", value: po.requisitionId ? <Link className="text-brand-700 underline" href={`/app/suprimentos/requisicoes/${po.requisitionId}`}>abrir</Link> : "—" },
              { label: "Emitido por", value: users.get(po.createdById) }, { label: "Aprovado por", value: po.approvedById ? users.get(po.approvedById) : "—" },
            ]} />
            {po.notes && <p className="mt-2 text-sm text-slate-600">{po.notes}</p>}
          </Card>
          <ApprovalPanel ctx={ctx} entity="PurchaseOrder" entityId={id} back={back} />
          {can("purchase.write") && ["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(po.status) && receipts.length === 0 && (
            <Card title="Cancelar pedido">
              <ActionForm action={cancelPoAction}><input type="hidden" name="id" value={id} /><Input name="reason" label="Motivo" required /><SubmitButton variant="danger" confirm="Cancelar o pedido?">Cancelar</SubmitButton></ActionForm>
            </Card>
          )}
          {can("purchase.write") && open && (
            <Card title="Encerrar saldo">
              <Notice tone="info">Libera o compromisso não recebido. Documentos já recebidos continuam válidos.</Notice>
              <ActionForm action={closePoAction}><input type="hidden" name="id" value={id} /><Input name="reason" label="Motivo" required /><SubmitButton variant="secondary" confirm="Encerrar o saldo do pedido?">Encerrar</SubmitButton></ActionForm>
            </Card>
          )}
          {(can("purchase.write") || can("purchase.receive")) && ["PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"].includes(po.status) && (
            <Card title="Avaliar fornecedor">
              {evals.length > 0 && <p className="mb-2 text-xs text-slate-500">{evals.length} avaliação(ões) registrada(s) para este pedido.</p>}
              <ActionForm action={evaluateAction} resetOnSuccess>
                <input type="hidden" name="partyId" value={po.supplierPartyId} /><input type="hidden" name="purchaseOrderId" value={id} />
                <FormGrid cols={4}><Select name="quality" label="Qualidade" options={SCORE} /><Select name="deadline" label="Prazo" options={SCORE} /><Select name="price" label="Preço" options={SCORE} /><Select name="communication" label="Comunicação" options={SCORE} /></FormGrid>
                <Textarea name="comment" label="Comentário" />
                <SubmitButton variant="secondary">Registrar avaliação</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
