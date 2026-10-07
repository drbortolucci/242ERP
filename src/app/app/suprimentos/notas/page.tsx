import Link from "next/link";
import { PageHeader, Card, StatusBadge, Notice } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { ActionForm, Input, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pageAnyPerm } from "@/server/page-guard";
import { nameMap } from "@/modules/config/lookups";
import { pageQuery, sp, textSearch, type SearchParams } from "@/lib/query";
import { formatCivil } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { statusLabel } from "@/lib/labels";
import { acceptDivergenceAction, cancelInvoiceAction } from "../actions";

export const metadata = { title: "Documentos de fornecedor" };
export default async function SupplierInvoicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pageAnyPerm(ctx, "purchase.write", "finance.read");
  const q = pageQuery(s);
  const status = sp(s, "status");
  const where = { AND: [textSearch(q.q, ["number"]), status ? { status } : {}] };
  const [rows, total, divergent] = await Promise.all([
    ctx.db.supplierInvoice.findMany({ where, orderBy: { issueDate: "desc" }, skip: q.skip, take: q.take }), ctx.db.supplierInvoice.count({ where }),
    ctx.db.supplierInvoice.findMany({ where: { status: "DIVERGENT" }, orderBy: { createdAt: "asc" } }),
  ]);
  const all = [...rows, ...divergent];
  const [sn, pos, pays] = await Promise.all([
    nameMap(ctx, "party", all.map((r) => r.supplierPartyId)),
    ctx.db.purchaseOrder.findMany({ where: { id: { in: all.map((r) => r.purchaseOrderId).filter((x): x is string => !!x) } }, select: { id: true, number: true } }),
    ctx.db.payable.findMany({ where: { sourceType: "SUPPLIER_INVOICE", sourceId: { in: rows.map((r) => r.id) } }, select: { sourceId: true, number: true, status: true } }),
  ]);
  const poNum = new Map(pos.map((p) => [p.id, p.number]));
  const canApprove = ctx.permissions.has("purchase.approve");
  const canCancel = ctx.permissions.has("purchase.write") || ctx.permissions.has("finance.write");
  return (
    <>
      <PageHeader title="Documentos de cobrança de fornecedores" subtitle="Conferência de 3 vias: pedido × recebimento/aceite × documento" breadcrumbs={[{ label: "Suprimentos" }, { label: "Documentos de fornecedor" }]} />
      {divergent.length > 0 && (
        <Card title={`Divergências a tratar (${divergent.length})`} className="mb-6">
          <div className="space-y-4">
            {divergent.map((d) => (
              <div key={d.id} className="rounded border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm"><b>{d.number}</b> — {sn.get(d.supplierPartyId)} — {formatMoney(d.amount)} — pedido {d.purchaseOrderId && <Link className="text-brand-700 underline" href={`/app/suprimentos/pedidos/${d.purchaseOrderId}`}>{poNum.get(d.purchaseOrderId)}</Link>}</p>
                <p className="text-xs text-amber-900">{d.divergenceNote}</p>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  {canApprove && <ActionForm action={acceptDivergenceAction}><input type="hidden" name="id" value={d.id} /><Input name="reason" label="Justificativa para aceitar" required /><SubmitButton variant="secondary" confirm="Aceitar a divergência e gerar conta a pagar?">Aceitar divergência</SubmitButton></ActionForm>}
                  {canCancel && <ActionForm action={cancelInvoiceAction}><input type="hidden" name="id" value={d.id} /><Input name="reason" label="Motivo da recusa" required /><SubmitButton variant="danger">Recusar documento</SubmitButton></ActionForm>}
                </div>
              </div>
            ))}
          </div>
          {!canApprove && <Notice tone="info">Aceitar divergência exige permissão de aprovação de compras (e não pode ser feito por quem emitiu o pedido).</Notice>}
        </Card>
      )}
      <Toolbar base="/app/suprimentos/notas" params={s} filters={[{ name: "status", label: "Situação", options: ["RECEIVED", "DIVERGENT", "APPROVED", "CANCELED"].map((v) => ({ value: v, label: statusLabel(v) })) }]} />
      <DataTable rows={rows} columns={[
        { key: "number", label: "Número" }, { key: "s", label: "Fornecedor", render: (r) => <Link className="text-brand-700 underline" href={`/app/cadastros/fornecedores/${r.supplierPartyId}`}>{sn.get(r.supplierPartyId)}</Link> },
        { key: "po", label: "Pedido", render: (r) => r.purchaseOrderId ? <Link className="text-brand-700 underline" href={`/app/suprimentos/pedidos/${r.purchaseOrderId}`}>{poNum.get(r.purchaseOrderId)}</Link> : "—" },
        { key: "i", label: "Emissão", render: (r) => formatCivil(r.issueDate) }, { key: "c", label: "Competência", render: (r) => formatCivil(r.competence).slice(3) }, { key: "d", label: "Vencimento", render: (r) => formatCivil(r.dueDate) },
        { key: "a", label: "Valor", align: "right", render: (r) => formatMoney(r.amount) }, { key: "st", label: "Situação", render: (r) => <StatusBadge status={r.status} /> },
        { key: "p", label: "Conta a pagar", render: (r) => { const p = pays.find((x) => x.sourceId === r.id); return p ? <>{p.number} <StatusBadge status={p.status} /></> : "—"; } },
        { key: "x", label: "", render: (r) => r.status === "APPROVED" && canCancel ? <ActionForm action={cancelInvoiceAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="reason" value="Cancelamento solicitado na lista" /><SubmitButton variant="danger" confirm="Cancelar o documento e a conta a pagar (se não liquidada)?">Cancelar</SubmitButton></ActionForm> : null },
      ]} />
      <Pagination base="/app/suprimentos/notas" params={s} page={q.page} pageSize={q.pageSize} total={total} />
    </>
  );
}
