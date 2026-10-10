import Link from "@/components/ui/access-link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { PageHeader, Card, DefinitionList, StatusBadge, Notice, Badge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionButton, ActionForm, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { ApprovalPanel } from "@/components/approval-panel";
import { lookups, nameMap, userNameMap } from "@/modules/config/lookups";
import { formatCivil, todayIn } from "@/lib/dates";
import { formatMoney, formatQty, sum } from "@/lib/money";
import { submitMeasurementAction, adjustmentAction, removeItemAction, cancelMeasurementAction, clientApproveAction, invoiceAction } from "../../actions";

const TYPE: Record<string, string> = { TIME_ENTRY: "Horas", MILESTONE: "Marco", RECURRING_FEE: "Mensalidade", AMS_FEE: "Mensalidade AMS", AMS_OVERAGE: "Excedente AMS", EXPENSE: "Despesa", ADJUSTMENT: "Ajuste" };
function sourceHref(type: string, id: string | null, contractId: string) {
  if (!id) return null;
  if (type === "TIME_ENTRY") return `/app/horas/aprovacao?id=${id}`;
  if (type === "EXPENSE") return `/app/despesas/${id}`;
  if (type === "AMS_OVERAGE" || type === "AMS_FEE") return `/app/ams/saldos/${contractId}`;
  return `/app/contratos/${contractId}`;
}

export default async function MeasurementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  pagePerm(ctx, "billing.read");
  const m = await ctx.db.measurement.findFirst({ where: { id } });
  if (!m) notFound();
  const [items, docs, contract, pos, terms] = await Promise.all([
    ctx.db.measurementItem.findMany({ where: { measurementId: id, status: { not: "REMOVED" } }, orderBy: [{ sourceType: "asc" }, { description: "asc" }] }),
    ctx.db.billingDocument.findMany({ where: { measurementId: id }, orderBy: { createdAt: "asc" } }),
    ctx.db.contract.findFirstOrThrow({ where: { id: m.contractId } }), ctx.db.customerPurchaseOrder.findMany({ where: { contractId: m.contractId, active: true } }), lookups.paymentTerms(ctx),
  ]);
  const [pn, users] = await Promise.all([nameMap(ctx, "party", [m.partyId]), userNameMap([m.createdById, m.approvedById])]);
  const active = items.filter((i) => i.status === "ACTIVE");
  const can = (p: string) => ctx.permissions.has(p);
  const invoiceable = ["APPROVED", "CLIENT_APPROVED", "PARTIALLY_INVOICED"].includes(m.status) && can("billing.issue") && active.length > 0;
  const columns = [
    { key: "t", label: "Origem", render: (i: (typeof items)[number]) => { const h = sourceHref(i.sourceType, i.sourceId, m.contractId); return h ? <Link className="text-brand-700 underline" href={h}>{TYPE[i.sourceType] ?? i.sourceType}</Link> : TYPE[i.sourceType] ?? i.sourceType; } },
    { key: "description", label: "Descrição" }, { key: "q", label: "Qtd.", align: "right" as const, render: (i: (typeof items)[number]) => formatQty(i.quantity) },
    { key: "u", label: "Unitário", align: "right" as const, render: (i: (typeof items)[number]) => formatMoney(i.unitPrice) }, { key: "a", label: "Valor", align: "right" as const, render: (i: (typeof items)[number]) => formatMoney(i.amount) },
    { key: "s", label: "Situação", render: (i: (typeof items)[number]) => (i.status === "INVOICED" ? <Link className="text-brand-700 underline" href={`/app/faturamento/cobrancas/${i.billingDocumentId}`}><Badge tone="green">faturado</Badge></Link> : <Badge tone="blue">a faturar</Badge>) },
  ];
  return (
    <>
      <PageHeader title={`Medição ${m.number}`} subtitle={<StatusBadge status={m.status} />} breadcrumbs={[{ label: "Medições", href: "/app/faturamento/medicoes" }, { label: m.number }]}
        actions={m.status === "DRAFT" && can("billing.measure") && <ActionButton action={submitMeasurementAction} fields={{ id }} variant="primary">Enviar para aprovação</ActionButton>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {invoiceable ? (
            <Card title="Itens — selecione o que faturar agora (faturamento parcial permitido)">
              <ActionForm action={invoiceAction}>
                <input type="hidden" name="measurementId" value={id} /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
                <table className="min-w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="p-1" /><th className="p-1">Origem</th><th className="p-1">Descrição</th><th className="p-1 text-right">Valor</th></tr></thead>
                  <tbody>{active.map((i) => <tr key={i.id} className="border-t"><td className="p-1"><input type="checkbox" name="itemIds[]" value={i.id} defaultChecked aria-label={`Faturar ${i.description}`} /></td><td className="p-1">{TYPE[i.sourceType] ?? i.sourceType}</td><td className="p-1">{i.description}</td><td className="p-1 text-right tabular-nums">{formatMoney(i.amount)}</td></tr>)}</tbody>
                </table>
                <FormGrid cols={4}><Input name="issueDate" type="date" label="Emissão" defaultValue={todayIn(ctx.timezone)} required /><Input name="discountAmount" label="Desconto" defaultValue="0" /><Select name="customerPo" label="OC do cliente" options={pos.map((p) => ({ value: p.number, label: `${p.number} (${formatMoney(p.amount)})` }))} placeholder={contract.requiresPo ? "Selecione" : "—"} /><Select name="paymentTermId" label="Condição" options={terms} placeholder="Do contrato" /></FormGrid>
                <SubmitButton>Emitir documento de cobrança</SubmitButton>
                <p className="text-xs text-slate-500">Retenções aplicadas conforme regras cadastradas e validadas pela empresa. O documento de cobrança não é nota fiscal.</p>
              </ActionForm>
            </Card>
          ) : null}
          <Card title={`Itens da medição (${items.length})`}>
            <DataTable dense rows={items} columns={m.status === "DRAFT" && can("billing.measure") ? [...columns, { key: "x", label: "", render: (i) => i.status === "ACTIVE" ? <ActionForm action={removeItemAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="itemId" value={i.id} /><SubmitButton variant="secondary">Remover</SubmitButton></ActionForm> : null }] : columns} />
            <p className="mt-2 text-right text-sm font-medium">Total: {formatMoney(m.totalAmount)} · Faturado: {formatMoney(sum(items.filter((i) => i.status === "INVOICED").map((i) => i.amount)))}</p>
          </Card>
          {m.status === "DRAFT" && can("billing.measure") && (
            <Card title="Ajuste manual (justificado)">
              <ActionForm action={adjustmentAction} resetOnSuccess><input type="hidden" name="id" value={id} /><FormGrid cols={2}><Input name="description" label="Descrição e justificativa" required /><Input name="amount" label="Valor (negativo = desconto)" required /></FormGrid><SubmitButton variant="secondary">Incluir ajuste</SubmitButton></ActionForm>
            </Card>
          )}
          <Card title="Documentos de cobrança">
            <DataTable dense rows={docs} empty="Nenhum documento emitido." columns={[{ key: "n", label: "Número", render: (d) => <Link className="text-brand-700 underline" href={`/app/faturamento/cobrancas/${d.id}`}>{d.number}</Link> }, { key: "i", label: "Emissão", render: (d) => formatCivil(d.issueDate) }, { key: "g", label: "Bruto", align: "right", render: (d) => formatMoney(d.grossAmount) }, { key: "l", label: "Líquido", align: "right", render: (d) => formatMoney(d.netAmount) }, { key: "s", label: "Situação", render: (d) => <StatusBadge status={d.status} /> }]} />
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Dados">
            <DefinitionList items={[
              { label: "Contrato", value: <Link className="text-brand-700 underline" href={`/app/contratos/${contract.id}`}>{contract.number}</Link> }, { label: "Cliente", value: pn.get(m.partyId) },
              { label: "Período", value: `${formatCivil(m.periodStart)} a ${formatCivil(m.periodEnd)}` }, { label: "Competência", value: formatCivil(m.competence).slice(3) },
              { label: "Aprovação do cliente", value: contract.requiresClientMeasurementApproval ? (m.clientApprovedAt ? `por ${m.clientApprovedByName}` : "exigida") : "não exigida" },
              { label: "OC obrigatória", value: contract.requiresPo ? "sim" : "não" }, { label: "Medido por", value: users.get(m.createdById) }, { label: "Aprovado por", value: m.approvedById ? users.get(m.approvedById) : "—" },
            ]} />
            {m.notes && <p className="mt-2 text-sm text-slate-600">{m.notes}</p>}
          </Card>
          <ApprovalPanel ctx={ctx} entity="Measurement" entityId={id} back={`/app/faturamento/medicoes/${id}`} />
          {m.status === "CLIENT_PENDING" && can("billing.approve") && (
            <Card title="Registrar aprovação do cliente">
              <Notice tone="info">Use quando a aprovação ocorreu fora do portal (e-mail, ata) — anexe a evidência na medição.</Notice>
              <ActionForm action={clientApproveAction}><input type="hidden" name="id" value={id} /><Input name="byName" label="Aprovado por (nome no cliente)" required /><SubmitButton variant="secondary">Registrar</SubmitButton></ActionForm>
            </Card>
          )}
          {can("billing.measure") && !["CANCELED", "INVOICED", "PARTIALLY_INVOICED"].includes(m.status) && (
            <Card title="Cancelar medição"><ActionForm action={cancelMeasurementAction}><input type="hidden" name="id" value={id} /><Input name="reason" label="Motivo" required /><SubmitButton variant="danger" confirm="Cancelar e liberar as origens?">Cancelar</SubmitButton></ActionForm></Card>
          )}
        </div>
      </div>
    </>
  );
}
