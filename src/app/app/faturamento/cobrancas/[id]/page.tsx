import Link from "@/components/ui/access-link";
import { notFound } from "next/navigation";
import { PageHeader, Card, DefinitionList, StatusBadge, Badge, Notice, SimulatedBanner } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionButton, ActionForm, Input, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { nameMap, userNameMap } from "@/modules/config/lookups";
import { formatCivil, formatInstant } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { requestFiscalAction, cancelInvoiceDocAction } from "../../actions";
import { FISCAL } from "../../constants";

export default async function BillingDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  pagePerm(ctx, "billing.read");
  const d = await ctx.db.billingDocument.findFirst({ where: { id } });
  if (!d) notFound();
  const [items, recs, fiscal, measurement, contract] = await Promise.all([
    ctx.db.measurementItem.findMany({ where: { billingDocumentId: id } }), ctx.db.receivable.findMany({ where: { billingDocumentId: id }, orderBy: { installment: "asc" } }),
    ctx.db.fiscalDocument.findFirst({ where: { billingDocumentId: id } }), ctx.db.measurement.findFirst({ where: { id: d.measurementId } }), ctx.db.contract.findFirst({ where: { id: d.contractId } }),
  ]);
  const [pn, users] = await Promise.all([nameMap(ctx, "party", [d.partyId]), userNameMap([d.createdById])]);
  const wh = d.withholdings as { code: string; name: string; ratePct: string; base: string; amount: string }[];
  const can = (p: string) => ctx.permissions.has(p);
  const [fl, ft] = FISCAL[d.fiscalStatus] ?? [d.fiscalStatus, "slate"];
  return (
    <>
      <PageHeader title={`Documento de cobrança ${d.number}`} subtitle={<span className="flex gap-2"><StatusBadge status={d.status} /><Badge tone={ft}>NFS-e {fl}</Badge></span>} breadcrumbs={[{ label: "Documentos de cobrança", href: "/app/faturamento/cobrancas" }, { label: d.number }]}
        actions={<a className="rounded border px-3 py-1.5 text-sm" href={`/api/pdf/cobranca/${id}`} target="_blank" rel="noreferrer">PDF (documento interno)</a>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Itens faturados">
            <DataTable dense rows={items} columns={[{ key: "description", label: "Descrição" }, { key: "q", label: "Qtd.", align: "right", render: (i) => formatQty(i.quantity) }, { key: "u", label: "Unitário", align: "right", render: (i) => formatMoney(i.unitPrice) }, { key: "a", label: "Valor", align: "right", render: (i) => formatMoney(i.amount) }]} />
          </Card>
          <Card title="Retenções aplicadas">
            {wh.length === 0 ? <p className="text-sm text-slate-500">Nenhuma regra de retenção aplicável cadastrada.</p> : <DataTable dense rows={wh.map((w) => ({ ...w, id: w.code }))} columns={[{ key: "code", label: "Código" }, { key: "name", label: "Regra" }, { key: "r", label: "Alíquota cadastrada", align: "right", render: (w) => `${Number(w.ratePct).toLocaleString("pt-BR")}%` }, { key: "b", label: "Base", align: "right", render: (w) => formatMoney(w.base) }, { key: "a", label: "Valor", align: "right", render: (w) => formatMoney(w.amount) }]} />}
            <p className="mt-2 text-xs text-slate-500">As regras de retenção são cadastradas e validadas pela empresa (responsável fiscal); o sistema apenas as aplica.</p>
          </Card>
          <Card title="Títulos a receber">
            <DataTable dense rows={recs} columns={[{ key: "n", label: "Número", render: (r) => <Link className="text-brand-700 underline" href={`/app/financeiro/titulos/receber/${r.id}`}>{r.number}</Link> }, { key: "p", label: "Parcela", render: (r) => `${r.installment}/${r.installments}` }, { key: "d", label: "Vencimento", render: (r) => formatCivil(r.dueDate) }, { key: "a", label: "Valor", align: "right", render: (r) => formatMoney(r.amount) }, { key: "o", label: "Em aberto", align: "right", render: (r) => formatMoney(r.openAmount) }, { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> }]} />
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Valores">
            <DefinitionList items={[
              { label: "Cliente", value: pn.get(d.partyId) }, { label: "Contrato", value: contract ? <Link className="text-brand-700 underline" href={`/app/contratos/${contract.id}`}>{contract.number}</Link> : "—" },
              { label: "Medição", value: measurement ? <Link className="text-brand-700 underline" href={`/app/faturamento/medicoes/${measurement.id}`}>{measurement.number}</Link> : "—" },
              { label: "Emissão", value: formatCivil(d.issueDate) }, { label: "Competência", value: formatCivil(d.competence).slice(3) }, { label: "OC do cliente", value: d.customerPo ?? "—" },
              { label: "Bruto", value: formatMoney(d.grossAmount) }, { label: "Desconto", value: formatMoney(d.discountAmount) }, { label: "Retenções", value: formatMoney(d.withholdingAmount) },
              { label: "Líquido a receber", value: <b>{formatMoney(d.netAmount)}</b> }, { label: "Adiantamento aplicado", value: formatMoney(d.advanceApplied) }, { label: "Emitido por", value: users.get(d.createdById) },
              ...(d.cancelReason ? [{ label: "Cancelamento", value: `${d.cancelReason} (${formatInstant(d.canceledAt, ctx.timezone)})` }] : []),
            ]} />
          </Card>
          <Card title="NFS-e">
            {fiscal?.environment === "SIMULATED" && <SimulatedBanner what="Emissão fiscal" />}
            <DefinitionList items={[{ label: "Situação", value: <Badge tone={ft}>{fl}</Badge> }, { label: "Provedor", value: fiscal ? `${fiscal.provider} (${fiscal.environment})` : "—" }, { label: "Número", value: fiscal?.number ?? "—" }, { label: "Código de verificação", value: fiscal?.verificationCode ?? "—" }, { label: "Tentativas", value: fiscal?.attempts ?? 0 }, ...(fiscal?.lastError ? [{ label: "Mensagem", value: <span className="text-red-700">{fiscal.lastError}</span> }] : [])]} />
            {d.status === "ISSUED" && can("billing.issue") && ["NOT_REQUESTED", "REJECTED", "CANCELED"].includes(d.fiscalStatus) && <div className="mt-3"><ActionButton action={requestFiscalAction} fields={{ id }} variant="primary">{d.fiscalStatus === "REJECTED" ? "Reenviar ao provedor fiscal" : "Solicitar NFS-e"}</ActionButton></div>}
            <p className="mt-2 text-xs text-slate-500">Em desenvolvimento e testes a emissão é simulada: nenhuma nota real é gerada. A conformidade fiscal depende de provedor real e validação do responsável fiscal.</p>
          </Card>
          {d.status === "ISSUED" && can("billing.cancel") && (
            <Card title="Cancelar documento">
              <Notice tone="warn">Exige títulos sem recebimentos, créditos ou compensações e NFS-e não autorizada.</Notice>
              <ActionForm action={cancelInvoiceDocAction}><input type="hidden" name="id" value={id} /><Input name="reason" label="Motivo" required /><SubmitButton variant="danger" confirm="Cancelar o documento de cobrança?">Cancelar</SubmitButton></ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
