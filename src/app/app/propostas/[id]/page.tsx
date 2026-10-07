import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card, StatusBadge, Notice, Tabs } from "@/components/ui/page";
import { ActionButton, ActionForm, Input, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { getProposal } from "@/modules/proposals/service";
import { lookups } from "@/modules/config/lookups";
import { ApprovalPanel } from "@/components/approval-panel";
import { Attachments } from "@/components/attachments";
import { formatCivil, toCivil, todayIn } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { ProposalEditor, type EditorValues } from "../editor";
import { submitProposalAction, newVersionAction, markSentAction, acceptAction, clientRejectAction, createOrderAction } from "../actions";

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  pagePerm(ctx, "crm.read");
  const vq = (await searchParams).v;
  const data = await getProposal(ctx, id, vq ? Number(vq) : undefined);
  if (!data) notFound();
  const { p, v, versions, lines, showCost } = data;
  const [services, roles, seniorities, terms, party, items, order] = await Promise.all([
    lookups.services(ctx), lookups.teamRoles(ctx), lookups.seniorities(ctx), lookups.paymentTerms(ctx), ctx.db.party.findFirst({ where: { id: p.partyId } }),
    ctx.db.priceTableItem.findMany(), ctx.db.salesOrder.findFirst({ where: { proposalId: id, status: { not: "CANCELED" } } }),
  ]);
  const rateHints: Record<string, { rate: string; cost: string }> = {};
  for (const it of items) rateHints[`${it.teamRoleId ?? ""}|${it.seniorityId ?? ""}`] = { rate: it.hourlyRate.toString(), cost: showCost ? it.referenceCost?.toString() ?? "0" : "0" };
  const isCurrent = v.version === p.currentVersion;
  const editable = isCurrent && (v.status === "DRAFT" || v.status === "REJECTED") && ctx.permissions.has("proposal.write");
  const d = (x: Date | null) => (x ? toCivil(x) : "");
  const initial: EditorValues = {
    commercialModel: v.commercialModel, scope: v.scope ?? "", deliverables: v.deliverables ?? "", assumptions: v.assumptions ?? "", exclusions: v.exclusions ?? "", schedule: v.schedule ?? "",
    startDate: d(v.startDate), endDate: d(v.endDate), months: String(v.months), validUntil: d(v.validUntil), paymentTermId: v.paymentTermId ?? "", discountPct: v.discountPct.toString(), taxRatePct: v.taxRatePct.toString(),
    lines: lines.map((l) => ({ kind: l.kind as EditorValues["lines"][number]["kind"], description: l.description, serviceId: l.serviceId ?? "", teamRoleId: l.teamRoleId ?? "", seniorityId: l.seniorityId ?? "", hours: l.hours.toString(), quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), unitCost: l.unitCost.toString(), billable: l.billable })),
  };
  const canWrite = ctx.permissions.has("proposal.write");
  const back = `/app/propostas/${id}`;
  return (
    <>
      <PageHeader title={`${p.number} — ${p.title}`} subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={p.status} /> Cliente: <Link className="text-brand-700 underline" href={`/app/cadastros/clientes/${p.partyId}`}>{party?.name}</Link> {p.opportunityId && <Link className="text-brand-700 underline" href={`/app/crm/oportunidades/${p.opportunityId}`}>oportunidade</Link>}</span>}
        breadcrumbs={[{ label: "Propostas", href: "/app/propostas" }, { label: p.number }]}
        actions={<>
          <a className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm" href={`/api/pdf/proposta/${id}?v=${v.version}`}>PDF</a>
          {canWrite && isCurrent && v.status === "DRAFT" && <ActionButton action={submitProposalAction} fields={{ id }} variant="primary">Submeter à aprovação</ActionButton>}
          {canWrite && isCurrent && v.status !== "DRAFT" && p.status !== "ACCEPTED" && <ActionButton action={newVersionAction} fields={{ id }} confirm="Criar nova versão? A atual ficará como histórico.">Nova versão</ActionButton>}
          {canWrite && p.status === "APPROVED" && <ActionButton action={markSentAction} fields={{ id }}>Marcar como enviada</ActionButton>}
        </>} />
      <Tabs active={String(v.version)} tabs={versions.map((x) => ({ key: String(x.version), label: `v${x.version} · ${x.status === "SUPERSEDED" ? "substituída" : x.status === "APPROVED" ? "aprovada" : x.status === "ACCEPTED" ? "aceita" : x.status === "PENDING_APPROVAL" ? "em aprovação" : x.status === "REJECTED" ? "rejeitada" : "rascunho"}`, href: `${back}?v=${x.version}` }))} />
      {!editable && <div className="mb-4"><Notice tone="info">{isCurrent ? "Versão bloqueada para edição (aprovada, enviada ou em aprovação). Valores e condições estão preservados; para alterar, crie nova versão." : "Versão histórica (somente leitura)."}</Notice></div>}
      <div className="grid gap-6 xl:grid-cols-4">
        <Card className="xl:col-span-3" title={`Versão ${v.version} — validade ${formatCivil(v.validUntil)}`}>
          <ProposalEditor proposalId={id} initial={initial} lk={{ services, roles, seniorities, terms }} readOnly={!editable} showCost={showCost} rateHints={rateHints} />
        </Card>
        <div className="space-y-6">
          <ApprovalPanel ctx={ctx} entity="Proposal" entityId={id} back={back} />
          {canWrite && ["APPROVED", "SENT"].includes(p.status) && (
            <Card title="Registrar aceite do cliente">
              <p className="mb-2 text-xs text-slate-600">Registro de aceite com comprovação anexada. Não equivale a assinatura eletrônica certificada.</p>
              <ActionForm action={acceptAction}>
                <input type="hidden" name="id" value={id} />
                <Input name="acceptedByName" label="Aceito por (nome/cargo)" required />
                <Input name="acceptedOn" type="date" label="Data do aceite" defaultValue={todayIn(ctx.timezone)} />
                <Input name="note" label="Forma de aceite/observação" />
                <SubmitButton>Registrar aceite</SubmitButton>
              </ActionForm>
              <details className="mt-3"><summary className="cursor-pointer text-xs text-red-700">Cliente recusou</summary>
                <ActionForm action={clientRejectAction}><input type="hidden" name="id" value={id} /><Input name="reason" label="Motivo" required /><SubmitButton variant="danger">Registrar recusa</SubmitButton></ActionForm>
              </details>
            </Card>
          )}
          {p.status === "ACCEPTED" && (
            <Card title="Pedido de venda">
              {order ? <p className="text-sm">Pedido <Link className="text-brand-700 underline" href={`/app/pedidos/${order.id}`}>{order.number}</Link> gerado.</p> : ctx.permissions.has("contract.write") ? (
                <ActionForm action={createOrderAction}>
                  <input type="hidden" name="id" value={id} />
                  <p className="text-xs text-slate-600">Valor: {formatMoney(v.netRevenue)} (versão {v.version} aceita por {v.acceptedByName}).</p>
                  <Input name="orderDate" type="date" label="Data do pedido" defaultValue={todayIn(ctx.timezone)} required />
                  <Input name="customerPo" label="Ordem de compra do cliente" />
                  <SubmitButton>Gerar pedido de venda</SubmitButton>
                </ActionForm>
              ) : <p className="text-sm text-slate-500">Aguardando área comercial gerar o pedido.</p>}
            </Card>
          )}
          <Attachments ctx={ctx} entity="Proposal" entityId={id} back={back} canUpload={canWrite} title="Anexos e comprovação de aceite" />
        </div>
      </div>
    </>
  );
}
