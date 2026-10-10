import { toPlain } from "@/lib/utils";
import Link from "@/components/ui/access-link";
import { notFound } from "next/navigation";
import { PageHeader, Card, DefinitionList, StatusBadge, Tabs, Grid, Stat, Badge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionButton, ActionForm, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { contractAlerts, contractBalances } from "@/modules/contracts/service";
import { lookups, nameMap, userNameMap } from "@/modules/config/lookups";
import { Attachments } from "@/components/attachments";
import { ApprovalPanel } from "@/components/approval-panel";
import { formatMoney, formatPct, formatQty } from "@/lib/money";
import { formatCivil, todayIn } from "@/lib/dates";
import { statusLabel } from "@/lib/labels";
import { ContractForm } from "../contract-form";
import { contractLookups } from "../lk";
import * as A from "../actions";

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  pagePerm(ctx, "contract.read");
  const c = await ctx.db.contract.findFirst({ where: { id } });
  if (!c) notFound();
  const tab = (await searchParams).tab ?? "resumo";
  const base = `/app/contratos/${id}`;
  const canWrite = ctx.permissions.has("contract.write");
  const [b, alerts, party, projects] = await Promise.all([contractBalances(ctx, id), contractAlerts(ctx, [id]), ctx.db.party.findFirst({ where: { id: c.partyId } }), ctx.db.project.findMany({ where: { contractId: id } })]);
  return (
    <>
      <PageHeader title={`${c.number} v${c.version} — ${c.title}`} subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={c.status} /> {statusLabel(c.commercialModel)} · <Link className="text-brand-700 underline" href={`/app/cadastros/clientes/${c.partyId}`}>{party?.name}</Link></span>}
        breadcrumbs={[{ label: "Contratos", href: "/app/contratos" }, { label: c.number }]}
        actions={canWrite && <>
          {c.status === "ACTIVE" && <ActionButton action={A.renewalAction} fields={{ id }}>Iniciar renovação/upsell</ActionButton>}
          {c.status === "ACTIVE" && ctx.permissions.has("project.write") && projects.length === 0 && <Link className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white" href={`/app/projetos?novo=1&contrato=${id}`}>Gerar projeto</Link>}
        </>} />
      {alerts.length > 0 && <div className="mb-4 space-y-1">{alerts.map((a, i) => <div key={i} className="rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-900">{a.message}</div>)}</div>}
      <Grid cols={6}>
        <Stat label="Contratado" value={formatMoney(b.contracted)} hint="inclui aditivos aprovados" />
        <Stat label="Executado" value={formatMoney(b.executed)} />
        <Stat label="Faturado" value={formatMoney(b.billed)} href={`/app/faturamento/cobrancas?contrato=${id}`} />
        <Stat label="Recebido" value={formatMoney(b.received)} href={`/app/financeiro/receber?contrato=${id}`} />
        <Stat label="Saldo disponível" value={formatMoney(b.available)} hint={formatPct(b.availablePct)} tone={b.available.lt(0) ? "bad" : b.availablePct && b.availablePct.lt(c.lowBalancePct) ? "warn" : "default"} />
        <Stat label="Executado não faturado" value={formatMoney(b.unbilled)} href={`/app/faturamento/pendencias?contrato=${id}`} tone={b.unbilled.gt(0) ? "warn" : "default"} />
      </Grid>
      <div className="mt-6"><Tabs active={tab} tabs={[["resumo", "Resumo"], ["tarifas", "Itens e tarifas"], ["marcos", "Marcos"], ["aditivos", "Aditivos e mudanças"], ["ocs", "OCs do cliente"], ["editar", "Editar"], ["docs", "Documentos"]].map(([k, l]) => ({ key: k, label: l, href: `${base}?tab=${k}` }))} /></div>
      {tab === "resumo" && <Resumo />}
      {tab === "tarifas" && <Tarifas />}
      {tab === "marcos" && <Marcos />}
      {tab === "aditivos" && <Aditivos />}
      {tab === "ocs" && <Ocs />}
      {tab === "editar" && canWrite && <Card><ContractForm action={A.updateContractAction} c={toPlain(c)} hidden={{ id }} lk={await contractLookups(ctx)} /></Card>}
      {tab === "docs" && <Attachments ctx={ctx} entity="Contract" entityId={id} back={`${base}?tab=docs`} canUpload={canWrite} allowClientVisibility />}
    </>
  );

  async function Resumo() {
    const [users, so, comms] = await Promise.all([userNameMap([c!.ownerUserId]), c!.salesOrderId ? ctx.db.salesOrder.findFirst({ where: { id: c!.salesOrderId } }) : null, ctx.db.commissionEntry.findMany({ where: { contractId: id } })]);
    return (
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Condições" className="lg:col-span-2">
          <DefinitionList items={[
            { label: "Vigência", value: `${formatCivil(c!.startDate)} a ${formatCivil(c!.endDate)}` }, { label: "Faturamento", value: `${c!.billingFrequency} · dia ${c!.billingDay}` }, { label: "Excedente", value: c!.overagePolicy },
            { label: "Reconhecimento de receita", value: c!.revenueMethod }, { label: "Horas", value: b.hoursLimit ? `${formatQty(b.hoursUsed)} de ${formatQty(b.hoursLimit)}` : formatQty(b.hoursUsed) }, { label: "Responsável", value: users.get(c!.ownerUserId ?? "") },
            { label: "Mensalidade", value: c!.monthlyFee ? formatMoney(c!.monthlyFee) : "—" }, { label: "Franquia", value: c!.franchiseHours ? `${formatQty(c!.franchiseHours)} h/mês` : "—" }, { label: "Excedente/h", value: c!.overageRate ? formatMoney(c!.overageRate) : "—" },
            { label: "Aprovação de horas pelo cliente", value: c!.requiresClientTimesheetApproval ? "Sim" : "Não" }, { label: "Reajuste", value: c!.adjustmentIndex ? `${c!.adjustmentIndex} (mês ${c!.adjustmentMonth})` : "—" }, { label: "Assinatura", value: c!.signedAt ? `${formatCivil(c!.signedAt)} — ${c!.signatureEvidence ?? ""}` : "—" },
          ]} />
          <h3 className="mb-2 mt-4 text-sm font-semibold">Rastreabilidade</h3>
          <p className="text-sm">{c!.opportunityId && <Link className="text-brand-700 underline" href={`/app/crm/oportunidades/${c!.opportunityId}`}>Oportunidade</Link>} {so && <> → <Link className="text-brand-700 underline" href={`/app/propostas/${so.proposalId}`}>Proposta</Link> → <Link className="text-brand-700 underline" href={`/app/pedidos/${so.id}`}>Pedido {so.number}</Link></>} → Contrato {projects.map((p) => <span key={p.id}> → <Link className="text-brand-700 underline" href={`/app/projetos/${p.id}`}>Projeto {p.code}</Link></span>)}</p>
        </Card>
        <div className="space-y-6">
          {canWrite && c!.status === "DRAFT" && (
            <Card title="Ativar contrato">
              <ActionForm action={A.activateContractAction}>
                <input type="hidden" name="id" value={id} />
                <Input name="signedAt" type="date" label="Data de assinatura" defaultValue={todayIn(ctx.timezone)} />
                <Input name="signatureEvidence" label="Comprovação (assinatura externa / anexo)" />
                <SubmitButton>Ativar</SubmitButton>
              </ActionForm>
            </Card>
          )}
          {canWrite && c!.status === "ACTIVE" && (
            <Card title="Encerrar, suspender ou cancelar">
              <ActionForm action={A.contractStatusAction}>
                <input type="hidden" name="id" value={id} />
                <Select name="status" label="Ação" options={[{ value: "SUSPENDED", label: "Suspender" }, { value: "ENDED", label: "Encerrar" }, { value: "CANCELED", label: "Cancelar" }]} />
                <Input name="reason" label="Motivo" required />
                <SubmitButton variant="danger" confirm="Confirmar alteração da situação do contrato?">Aplicar</SubmitButton>
              </ActionForm>
            </Card>
          )}
          {comms.length > 0 && ctx.permissions.has("commission.manage") && <Card title="Comissões"><ul className="text-sm">{comms.map((x) => <li key={x.id}>{formatMoney(x.amount)} · {x.sourceType} · <StatusBadge status={x.status === "ACCRUED" ? "PENDING" : x.status} /></li>)}</ul></Card>}
        </div>
      </div>
    );
  }

  async function Tarifas() {
    const [items, rates, roles, sens, profs] = await Promise.all([ctx.db.contractItem.findMany({ where: { contractId: id } }), ctx.db.contractRate.findMany({ where: { contractId: id }, orderBy: { validFrom: "desc" } }), lookups.teamRoles(ctx), lookups.seniorities(ctx), lookups.professionals(ctx)]);
    const [rn, sn, pn] = await Promise.all([nameMap(ctx, "teamRole", rates.map((r) => r.teamRoleId)), nameMap(ctx, "seniorityLevel", rates.map((r) => r.seniorityId)), nameMap(ctx, "professional", rates.map((r) => r.professionalId))]);
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Itens contratados"><DataTable dense rows={items} columns={[{ key: "description", label: "Item" }, { key: "kind", label: "Tipo" }, { key: "q", label: "Qtd/horas", align: "right", render: (i) => formatQty(i.quantity) }, { key: "u", label: "Unitário", align: "right", render: (i) => formatMoney(i.unitPrice) }, { key: "a", label: "Valor", align: "right", render: (i) => formatMoney(i.amount) }]} /></Card>
        <Card title="Tarifas por perfil/profissional (com vigência)">
          <DataTable dense rows={rates} columns={[{ key: "who", label: "Aplica a", render: (r) => pn.get(r.professionalId ?? "") ?? ([rn.get(r.teamRoleId ?? ""), sn.get(r.seniorityId ?? "")].filter(Boolean).join(" · ") || "Genérica") }, { key: "rate", label: "Tarifa/h", align: "right", render: (r) => formatMoney(r.hourlyRate) }, { key: "v", label: "Vigência", render: (r) => `${formatCivil(r.validFrom)} – ${formatCivil(r.validTo)}` }, { key: "reason", label: "Motivo", render: (r) => r.reason ?? "—" }]} />
          {canWrite && (
            <ActionForm action={A.addRateAction} resetOnSuccess className="mt-3">
              <input type="hidden" name="contractId" value={id} />
              <FormGrid cols={3}><Select name="teamRoleId" label="Papel" options={roles} placeholder="—" /><Select name="seniorityId" label="Senioridade" options={sens} placeholder="—" /><Select name="professionalId" label="Profissional" options={profs} placeholder="—" /><Input name="hourlyRate" label="Tarifa/h" required /><Input name="validFrom" type="date" label="Vigente a partir de" required /><Input name="reason" label="Motivo (reajuste)" /></FormGrid>
              <SubmitButton variant="secondary">Registrar tarifa</SubmitButton>
            </ActionForm>
          )}
        </Card>
      </div>
    );
  }

  async function Marcos() {
    const ms = await ctx.db.contractMilestone.findMany({ where: { contractId: id }, orderBy: { plannedDate: "asc" } });
    return (
      <Card title="Marcos de faturamento (preço fechado)">
        <DataTable rows={ms} columns={[{ key: "name", label: "Marco" }, { key: "amount", label: "Valor", align: "right", render: (m) => formatMoney(m.amount) }, { key: "plannedDate", label: "Previsto", render: (m) => formatCivil(m.plannedDate) }, { key: "status", label: "Situação", render: (m) => <StatusBadge status={m.status} /> }, { key: "acc", label: "Aceite", render: (m) => m.acceptedByName ? `${m.acceptedByName}` : canWrite && (m.status === "PENDING" || m.status === "READY") ? <ActionForm action={A.acceptMilestoneAction} className="flex gap-1 space-y-0"><input type="hidden" name="id" value={m.id} /><input type="hidden" name="contractId" value={id} /><Input name="acceptedByName" placeholder="Aceito por" aria-label="Aceito por" /><SubmitButton variant="secondary">Registrar aceite</SubmitButton></ActionForm> : "—" }]} empty={<p className="text-sm text-slate-500">Sem marcos.</p>} />
        {canWrite && <ActionForm action={A.addMilestoneAction} resetOnSuccess className="mt-4"><input type="hidden" name="contractId" value={id} /><FormGrid cols={3}><Input name="name" label="Marco" required /><Input name="amount" label="Valor" required /><Input name="plannedDate" type="date" label="Data prevista" /></FormGrid><SubmitButton variant="secondary">Incluir marco</SubmitButton></ActionForm>}
      </Card>
    );
  }

  async function Aditivos() {
    const [ams, crs] = await Promise.all([ctx.db.contractAmendment.findMany({ where: { contractId: id }, orderBy: { number: "desc" } }), ctx.db.changeRequest.findMany({ where: { contractId: id }, orderBy: { createdAt: "desc" } })]);
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Solicitações de mudança de escopo">
          <DataTable rows={crs} columns={[{ key: "title", label: "Mudança" }, { key: "v", label: "Valor", align: "right", render: (r) => formatMoney(r.valueDelta) }, { key: "h", label: "Horas", align: "right", render: (r) => formatQty(r.effortHoursDelta) }, { key: "status", label: "Situação", render: (r) => <StatusBadge status={r.status} /> }, { key: "d", label: "", render: (r) => r.status === "OPEN" && ctx.permissions.has("contract.approve") && <div className="flex gap-1"><ActionButton action={A.decideChangeRequestAction} fields={{ id: r.id, approve: "1", back: `${base}?tab=aditivos` }} variant="primary">Aprovar</ActionButton><ActionButton action={A.decideChangeRequestAction} fields={{ id: r.id, approve: "0", back: `${base}?tab=aditivos` }} variant="danger">Rejeitar</ActionButton></div> }]} empty={<p className="text-sm text-slate-500">Nenhuma.</p>} />
          {canWrite && <ActionForm action={A.createChangeRequestAction} resetOnSuccess className="mt-3"><input type="hidden" name="contractId" value={id} /><input type="hidden" name="back" value={`${base}?tab=aditivos`} /><Input name="title" label="Mudança solicitada" required /><Input name="description" label="Descrição" /><FormGrid cols={3}><Input name="effortHoursDelta" label="Δ horas" defaultValue="0" /><Input name="valueDelta" label="Δ valor" defaultValue="0" /><Input name="costDelta" label="Δ custo" defaultValue="0" /></FormGrid><SubmitButton variant="secondary">Registrar mudança</SubmitButton></ActionForm>}
        </Card>
        <Card title="Aditivos">
          <DataTable rows={ams} columns={[{ key: "number", label: "Nº" }, { key: "description", label: "Descrição" }, { key: "v", label: "Δ valor", align: "right", render: (a) => formatMoney(a.valueDelta) }, { key: "status", label: "Situação", render: (a) => <StatusBadge status={a.status} /> }, { key: "s", label: "", render: (a) => a.status === "DRAFT" && canWrite && <ActionButton action={A.submitAmendmentAction} fields={{ id: a.id, contractId: id }}>Enviar p/ aprovação</ActionButton> }]} empty={<p className="text-sm text-slate-500">Nenhum.</p>} />
          {ams.filter((a) => a.status === "PENDING_APPROVAL").map((a) => <div key={a.id} className="mt-3"><Badge tone="amber">Aditivo {a.number}</Badge><ApprovalPanel ctx={ctx} entity="ContractAmendment" entityId={a.id} back={`${base}?tab=aditivos`} /></div>)}
          {canWrite && <ActionForm action={A.createAmendmentAction} resetOnSuccess className="mt-3"><input type="hidden" name="contractId" value={id} /><Input name="description" label="Descrição" required /><FormGrid cols={3}><Input name="valueDelta" label="Δ valor" defaultValue="0" /><Input name="hoursDelta" label="Δ horas" defaultValue="0" /><Input name="newEndDate" type="date" label="Nova data final" /></FormGrid><SubmitButton variant="secondary">Criar aditivo</SubmitButton></ActionForm>}
        </Card>
      </div>
    );
  }

  async function Ocs() {
    const pos = await ctx.db.customerPurchaseOrder.findMany({ where: { contractId: id } });
    return (
      <Card title="Ordens de compra do cliente">
        <DataTable rows={pos} columns={[{ key: "number", label: "OC" }, { key: "amount", label: "Valor", align: "right", render: (p) => formatMoney(p.amount) }, { key: "v", label: "Vigência", render: (p) => `${formatCivil(p.validFrom)} – ${formatCivil(p.validTo)}` }]} empty={<p className="text-sm text-slate-500">Nenhuma OC.</p>} />
        {canWrite && <ActionForm action={A.addPoAction} resetOnSuccess className="mt-3"><input type="hidden" name="contractId" value={id} /><FormGrid cols={4}><Input name="number" label="Número" required /><Input name="amount" label="Valor" required /><Input name="validFrom" type="date" label="De" /><Input name="validTo" type="date" label="Até" /></FormGrid><SubmitButton variant="secondary">Registrar OC</SubmitButton></ActionForm>}
      </Card>
    );
  }
}
