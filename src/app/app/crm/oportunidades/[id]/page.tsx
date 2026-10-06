import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card, DefinitionList, StatusBadge, Notice } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionButton, ActionForm, Input, Select, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { Attachments } from "@/components/attachments";
import { nameMap, userNameMap } from "@/modules/config/lookups";
import { formatMoney } from "@/lib/money";
import { formatCivil, formatInstant } from "@/lib/dates";
import { crmLookups } from "../../lk";
import { OpportunityForm } from "../../opportunity-form";
import { ActivityForm } from "../../activity-form";
import { ACTIVITY_TYPES } from "../../constants";
import { updateOpportunityAction, winAction, loseAction, reopenAction, proposalFromOpportunityAction, completeActivityAction } from "../../actions";

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  pagePerm(ctx, "crm.read");
  const o = await ctx.db.opportunity.findFirst({ where: { id } });
  if (!o) notFound();
  const [lk, items, activities, proposals, orders] = await Promise.all([
    crmLookups(ctx), ctx.db.opportunityItem.findMany({ where: { opportunityId: id } }), ctx.db.activity.findMany({ where: { opportunityId: id }, orderBy: { createdAt: "desc" } }),
    ctx.db.proposal.findMany({ where: { opportunityId: id }, orderBy: { createdAt: "desc" } }), ctx.db.salesOrder.findMany({ where: { opportunityId: id } }),
  ]);
  const [party, users, stage, lossReason] = await Promise.all([ctx.db.party.findFirst({ where: { id: o.partyId } }), userNameMap([o.ownerUserId, ...activities.map((a) => a.ownerUserId)]), ctx.db.pipelineStage.findFirst({ where: { id: o.stageId } }), o.lossReasonId ? ctx.db.lossReason.findFirst({ where: { id: o.lossReasonId } }) : null]);
  const svc = await nameMap(ctx, "service", items.map((i) => i.serviceId));
  const canWrite = ctx.permissions.has("crm.write");
  const back = `/app/crm/oportunidades/${id}`;
  return (
    <>
      <PageHeader title={`${o.number} — ${o.title}`} subtitle={<span className="flex items-center gap-2"><StatusBadge status={o.status} /> {stage?.name} · <Link className="text-brand-700 underline" href={`/app/cadastros/clientes/${o.partyId}`}>{party?.name}</Link></span>}
        breadcrumbs={[{ label: "Oportunidades", href: "/app/crm/oportunidades" }, { label: o.number }]}
        actions={canWrite && (o.status === "OPEN" ? <>
          {ctx.permissions.has("proposal.write") && <ActionButton action={proposalFromOpportunityAction} fields={{ opportunityId: id }} variant="primary">Gerar proposta</ActionButton>}
          <ActionButton action={winAction} fields={{ id }} confirm="Marcar como ganha?">Ganhar</ActionButton>
        </> : <ActionButton action={reopenAction} fields={{ id }}>Reabrir</ActionButton>)} />
      {o.status === "WON" && proposals.length === 0 && <div className="mb-4"><Notice tone="info">Oportunidade ganha sem proposta: gere a proposta para formalizar escopo, valores e condições antes do pedido.</Notice></div>}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Resumo">
            <DefinitionList items={[
              { label: "Valor estimado", value: formatMoney(o.estimatedValue) }, { label: "Probabilidade", value: `${o.probability}%` }, { label: "Ponderado", value: formatMoney(o.estimatedValue.times(o.probability).div(100)) },
              { label: "Previsão de fechamento", value: formatCivil(o.expectedCloseDate) }, { label: "Responsável", value: users.get(o.ownerUserId ?? "") }, { label: "Origem", value: o.source },
              { label: "Concorrentes", value: o.competitors.join(", ") || "—" }, { label: "Próxima ação", value: o.nextAction ? `${o.nextAction} (${formatCivil(o.nextActionDate)})` : "—" },
              { label: "Última atividade", value: formatInstant(o.lastActivityAt, ctx.timezone) }, ...(lossReason ? [{ label: "Motivo da perda", value: `${lossReason.name}${o.lossNotes ? ` — ${o.lossNotes}` : ""}` }] : []),
            ]} />
            <h3 className="mb-2 mt-4 text-sm font-semibold">Serviços</h3>
            <DataTable dense rows={items} columns={[{ key: "s", label: "Serviço", render: (i) => svc.get(i.serviceId) }, { key: "m", label: "Modelo", render: (i) => i.commercialModel }, { key: "v", label: "Valor", align: "right", render: (i) => formatMoney(i.estimatedValue) }]} empty={<p className="text-sm text-slate-500">Sem itens detalhados.</p>} />
          </Card>
          {canWrite && o.status === "OPEN" && <Card title="Editar"><OpportunityForm action={updateOpportunityAction} lk={lk} o={o} items={items.map((i) => ({ serviceId: i.serviceId, commercialModel: i.commercialModel, estimatedValue: i.estimatedValue.toString() }))} /></Card>}
          <Card title="Interações e atividades">
            <ul className="divide-y text-sm">
              {activities.map((a) => (
                <li key={a.id} className="py-2">
                  <div className="flex justify-between gap-2"><b>{ACTIVITY_TYPES.find((t) => t.value === a.type)?.label}: {a.subject}</b><span className="text-xs text-slate-500">{a.doneAt ? `feito ${formatInstant(a.doneAt, ctx.timezone)}` : a.dueAt ? `previsto ${formatInstant(a.dueAt, ctx.timezone)}` : ""}</span></div>
                  {a.notes && <p className="text-slate-600">{a.notes}</p>}
                  {!a.doneAt && canWrite && <ActionButton action={completeActivityAction} fields={{ id: a.id, back }}>Concluir</ActionButton>}
                </li>
              ))}
            </ul>
            {canWrite && <div className="mt-3 border-t pt-3"><ActivityForm back={back} opportunityId={id} /></div>}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Documentos posteriores">
            <ul className="space-y-1 text-sm">
              {proposals.map((p) => <li key={p.id}><Link className="text-brand-700 underline" href={`/app/propostas/${p.id}`}>{p.number}</Link> <StatusBadge status={p.status} /></li>)}
              {orders.map((so) => <li key={so.id}>Pedido <Link className="text-brand-700 underline" href={`/app/pedidos/${so.id}`}>{so.number}</Link> <StatusBadge status={so.status} /></li>)}
              {!proposals.length && !orders.length && <li className="text-slate-500">Nenhum.</li>}
            </ul>
          </Card>
          {canWrite && o.status === "OPEN" && (
            <Card title="Marcar como perdida">
              <ActionForm action={loseAction}>
                <input type="hidden" name="id" value={id} />
                <Select name="lossReasonId" label="Motivo" options={lk.lossReasons} placeholder="Selecione" required />
                <Input name="notes" label="Detalhes" />
                <SubmitButton variant="danger">Perder</SubmitButton>
              </ActionForm>
            </Card>
          )}
          <Attachments ctx={ctx} entity="Opportunity" entityId={id} back={back} canUpload={canWrite} />
        </div>
      </div>
    </>
  );
}
