import { PageHeader, Card, StatusBadge, Stat, Grid, Badge } from "@/components/ui/page";
import { getTerms } from "@/modules/sectors/service";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { ActionForm, FormGrid, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { lookups, nameMap } from "@/modules/config/lookups";
import { OPEN_STATUSES } from "@/modules/ams/tickets";
import { pageQuery, sp, textSearch, type SearchParams } from "@/lib/query";
import { formatInstant } from "@/lib/dates";
import { statusLabel } from "@/lib/labels";
import { openTicketAction } from "../actions";
import { LEVEL_OPTIONS, PRIORITY_TONE, TYPE_OPTIONS, typeLabel } from "../constants";

export const metadata = { title: "Chamados" };
export default async function TicketsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  const terms = await getTerms(ctx);
  pagePerm(ctx, "ams.read");
  const q = pageQuery(s);
  const status = sp(s, "status") ?? "OPEN";
  const priority = sp(s, "priority");
  const sla = sp(s, "sla");
  const mine = sp(s, "mine");
  const statusWhere = status === "OPEN" ? { status: { in: OPEN_STATUSES } } : status === "ALL" ? {} : { status };
  const where = { AND: [textSearch(q.q, ["number", "title", "system", "module"]), statusWhere, priority ? { priority } : {}, sla === "breached" ? { OR: [{ responseBreached: true }, { resolutionBreached: true }] } : sla === "risk" ? { escalationLevel: 1, resolutionBreached: false } : {}, mine && ctx.professionalId ? { assigneeProfessionalId: ctx.professionalId } : {}] };
  const now = new Date();
  const [rows, total, openAll, customers, companies, contracts, professionals] = await Promise.all([
    ctx.db.ticket.findMany({ where, orderBy: [{ priority: "asc" }, { openedAt: "asc" }], skip: q.skip, take: q.take }), ctx.db.ticket.count({ where }),
    ctx.db.ticket.findMany({ where: { status: { in: OPEN_STATUSES } }, select: { priority: true, status: true, responseBreached: true, resolutionBreached: true, escalationLevel: true, resolutionDueAt: true } }),
    lookups.customers(ctx), lookups.companies(ctx), ctx.db.contract.findMany({ where: { commercialModel: "AMS_RECURRING", status: "ACTIVE" } }), lookups.professionals(ctx),
  ]);
  const [pn, prof] = await Promise.all([nameMap(ctx, "party", rows.map((r) => r.partyId)), nameMap(ctx, "professional", rows.map((r) => r.assigneeProfessionalId))]);
  const count = (f: (t: (typeof openAll)[number]) => boolean) => openAll.filter(f).length;
  const canWrite = ctx.permissions.has("ams.write");
  return (
    <>
      <PageHeader title={terms.tickets} breadcrumbs={[{ label: terms.supportArea }, { label: terms.tickets }]} />
      <Grid cols={5}>
        <Stat label="Abertos" value={openAll.length} href="/app/ams/chamados" />
        <Stat label="P1/P2 abertos" value={count((t) => t.priority === "P1" || t.priority === "P2")} tone={count((t) => t.priority === "P1") ? "bad" : "default"} href="/app/ams/chamados?priority=P1" />
        <Stat label="Em risco de SLA" value={count((t) => t.escalationLevel === 1 && !t.resolutionBreached)} tone="warn" href="/app/ams/chamados?sla=risk" />
        <Stat label="SLA violado (abertos)" value={count((t) => t.responseBreached || t.resolutionBreached)} tone="bad" href="/app/ams/chamados?sla=breached" />
        <Stat label="Aguardando cliente/terceiro" value={count((t) => t.status.startsWith("WAITING"))} href="/app/ams/chamados?status=WAITING_CUSTOMER" />
      </Grid>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Toolbar base="/app/ams/chamados" params={s} filters={[
            { name: "status", label: "Situação", options: [{ value: "OPEN", label: "Abertos" }, { value: "ALL", label: "Todos" }, ...["NEW", "IN_PROGRESS", "WAITING_CUSTOMER", "WAITING_THIRD_PARTY", "RESOLVED", "CLOSED", "CANCELED"].map((v) => ({ value: v, label: statusLabel(v) }))] },
            { name: "priority", label: "Prioridade", options: ["P1", "P2", "P3", "P4"].map((v) => ({ value: v, label: v })) },
            { name: "sla", label: "SLA", options: [{ value: "risk", label: "Em risco" }, { value: "breached", label: "Violado" }] },
            ...(ctx.professionalId ? [{ name: "mine", label: "Responsável", options: [{ value: "1", label: "Meus chamados" }] }] : []),
          ]} />
          <DataTable rows={rows} rowHref={(r) => `/app/ams/chamados/${r.id}`} columns={[
            { key: "number", label: "Número" }, { key: "p", label: "Prior.", render: (r) => <Badge tone={PRIORITY_TONE[r.priority]}>{r.priority}</Badge> },
            { key: "title", label: "Título", render: (r) => <>{r.title}<div className="text-xs text-slate-500">{typeLabel(r.type)}{r.system ? ` · ${r.system}` : ""}{r.module ? `/${r.module}` : ""}</div></> },
            { key: "c", label: "Cliente", render: (r) => pn.get(r.partyId) }, { key: "a", label: "Responsável", render: (r) => prof.get(r.assigneeProfessionalId ?? "") ?? <span className="text-amber-700">não atribuído</span> },
            { key: "o", label: "Aberto em", render: (r) => formatInstant(r.openedAt, ctx.timezone) },
            { key: "d", label: "Prazo solução", render: (r) => r.resolutionDueAt ? <span className={r.resolutionBreached ? "text-red-700" : r.pausedAt ? "text-slate-500" : r.resolutionDueAt < now && !r.resolvedAt ? "text-red-700" : ""}>{formatInstant(r.resolutionDueAt, ctx.timezone)}{r.pausedAt ? " (pausado)" : ""}</span> : "—" },
            { key: "sla", label: "SLA", render: (r) => r.responseBreached || r.resolutionBreached ? <Badge tone="red">violado</Badge> : r.escalationLevel === 1 ? <Badge tone="amber">em risco</Badge> : <Badge tone="green">ok</Badge> },
            { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> },
          ]} />
          <Pagination base="/app/ams/chamados" params={s} page={q.page} pageSize={q.pageSize} total={total} />
        </div>
        {canWrite && (
          <Card title="Abrir chamado">
            <ActionForm action={openTicketAction}>
              <Select name="partyId" label="Cliente" options={customers} required />
              <Select name="contractId" label="Contrato AMS" options={contracts.map((c) => ({ value: c.id, label: `${c.number} ${c.title}` }))} placeholder="Automático (contrato AMS ativo do cliente)" />
              <Select name="companyId" label="Empresa (sem contrato)" options={companies} placeholder="—" />
              <FormGrid cols={2}><Select name="type" label="Tipo" options={TYPE_OPTIONS} /><Input name="category" label="Categoria" /></FormGrid>
              <FormGrid cols={2}><Input name="system" label={terms.systemField} /><Input name="module" label={terms.moduleField} /></FormGrid>
              <Input name="title" label="Título" required />
              <Textarea name="description" label="Descrição" required />
              <FormGrid cols={2}><Select name="impact" label="Impacto" options={LEVEL_OPTIONS} defaultValue="3" /><Select name="urgency" label="Urgência" options={LEVEL_OPTIONS} defaultValue="3" /></FormGrid>
              <Input name="openedByContactName" label="Solicitante (contato do cliente)" />
              <Select name="assigneeProfessionalId" label="Responsável" options={professionals} placeholder="—" />
              <SubmitButton>Abrir chamado</SubmitButton>
              <p className="text-xs text-slate-500">Prioridade pela matriz impacto × urgência; prazos de SLA em horas úteis do calendário da política.</p>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
