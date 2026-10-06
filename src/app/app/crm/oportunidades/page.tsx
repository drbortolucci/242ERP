import Link from "next/link";
import { PageHeader, Card, Grid, Stat, StatusBadge, Tabs, Badge } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { crmMetrics, listOpportunities, staleDays, STALE_DAYS } from "@/modules/crm/service";
import { nameMap, userNameMap } from "@/modules/config/lookups";
import { pageQuery, sp, type SearchParams } from "@/lib/query";
import { formatMoney, formatPct, dec } from "@/lib/money";
import { formatCivil, formatMonth } from "@/lib/dates";
import { crmLookups } from "../lk";
import { OpportunityForm } from "../opportunity-form";
import { createOpportunityAction } from "../actions";
import { KanbanMove } from "./kanban-move";

export const metadata = { title: "Oportunidades" };

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pagePerm(ctx, "crm.read");
  const view = sp(s, "view") ?? "kanban";
  const q = pageQuery(s, 50);
  const [m, lk] = await Promise.all([crmMetrics(ctx), crmLookups(ctx)]);
  const status = sp(s, "status") ?? (view === "kanban" ? "OPEN" : undefined);
  const { rows, total } = await listOpportunities(ctx, view === "kanban" ? { ...q, skip: 0, take: 500 } : q, { status, stageId: sp(s, "etapa"), ownerUserId: sp(s, "responsavel") });
  const [parties, users] = await Promise.all([nameMap(ctx, "party", rows.map((r) => r.partyId)), userNameMap(rows.map((r) => r.ownerUserId))]);
  const stageNames = new Map(lk.allStages.map((x) => [x.value, x.label]));
  const canWrite = ctx.permissions.has("crm.write");
  const svcNames = await nameMap(ctx, "service", m.byService.map(([k]) => k));
  return (
    <>
      <PageHeader title="Oportunidades" breadcrumbs={[{ label: "Comercial" }, { label: "Oportunidades" }]} />
      <Grid cols={6}>
        <Stat label="Pipeline bruto" value={formatMoney(m.pipelineGross)} hint={`${m.openCount} abertas`} href="/app/crm/oportunidades?view=lista&status=OPEN" />
        <Stat label="Pipeline ponderado" value={formatMoney(m.pipelineWeighted)} hint="Σ valor × probabilidade" />
        <Stat label="Conversão" value={formatPct(m.conversionPct)} hint={`${m.wonCount} ganhas / ${m.lostCount} perdidas`} href="/app/crm/oportunidades?view=lista&status=WON" />
        <Stat label="Tempo médio de venda" value={m.avgCycleDays === null ? "—" : `${m.avgCycleDays} dias`} />
        <Stat label={`Sem atividade > ${STALE_DAYS}d`} value={m.stale.length} tone={m.stale.length ? "warn" : "good"} href="/app/crm/oportunidades?view=parados" />
        <Stat label="Próximas ações atrasadas" value={m.overdueNextActions.length} tone={m.overdueNextActions.length ? "bad" : "good"} href="/app/crm/oportunidades?view=parados" />
      </Grid>
      <div className="mt-6">
        <Tabs active={view} tabs={[{ key: "kanban", label: "Funil (kanban)", href: "/app/crm/oportunidades?view=kanban" }, { key: "lista", label: "Lista", href: "/app/crm/oportunidades?view=lista" }, { key: "previsao", label: "Previsão e vendas", href: "/app/crm/oportunidades?view=previsao" }, { key: "parados", label: "Atenção", href: "/app/crm/oportunidades?view=parados" }, ...(canWrite ? [{ key: "nova", label: "+ Nova", href: "/app/crm/oportunidades?view=nova" }] : [])]} />
      </div>
      {view === "kanban" && (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {lk.stages.map((st) => {
            const items = rows.filter((r) => r.stageId === st.value);
            return (
              <section key={st.value} className="w-72 shrink-0 rounded-lg bg-slate-200/60 p-2" aria-label={st.label}>
                <h2 className="mb-2 flex justify-between px-1 text-sm font-semibold"><span>{st.label}</span><span className="text-xs text-slate-600">{items.length} · {formatMoney(items.reduce((a, o) => a.plus(dec(o.estimatedValue)), dec(0)))}</span></h2>
                <ul className="space-y-2">
                  {items.map((o) => (
                    <li key={o.id} className="rounded-md bg-white p-2 text-sm shadow-sm">
                      <Link href={`/app/crm/oportunidades/${o.id}`} className="font-medium text-brand-700 hover:underline">{o.title}</Link>
                      <div className="text-xs text-slate-600">{parties.get(o.partyId)} · {formatMoney(o.estimatedValue)} · {o.probability}%</div>
                      <div className="text-xs text-slate-500">Fecha: {formatCivil(o.expectedCloseDate)} · {users.get(o.ownerUserId ?? "") ?? "—"}</div>
                      {(staleDays(o) ?? 99) > STALE_DAYS && <Badge tone="amber">sem atividade</Badge>}
                      {canWrite && <KanbanMove id={o.id} stages={lk.stages} current={o.stageId} />}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {view === "lista" && (
        <>
          <Toolbar base="/app/crm/oportunidades" params={s} filters={[{ name: "status", label: "Situação", options: [{ value: "OPEN", label: "Abertas" }, { value: "WON", label: "Ganhas" }, { value: "LOST", label: "Perdidas" }] }, { name: "etapa", label: "Etapa", options: lk.allStages }, { name: "responsavel", label: "Responsável", options: lk.users }]}>
            <input type="hidden" name="view" value="lista" />
          </Toolbar>
          <DataTable rows={rows} rowHref={(o) => `/app/crm/oportunidades/${o.id}`} columns={[
            { key: "number", label: "Número" }, { key: "title", label: "Título" }, { key: "party", label: "Cliente", render: (o) => parties.get(o.partyId) },
            { key: "stage", label: "Etapa", render: (o) => stageNames.get(o.stageId) }, { key: "status", label: "Situação", render: (o) => <StatusBadge status={o.status} /> },
            { key: "estimatedValue", label: "Valor", align: "right", render: (o) => formatMoney(o.estimatedValue) }, { key: "probability", label: "Prob.", align: "right", render: (o) => `${o.probability}%` },
            { key: "expectedCloseDate", label: "Previsão", render: (o) => formatCivil(o.expectedCloseDate) }, { key: "owner", label: "Responsável", render: (o) => users.get(o.ownerUserId ?? "") ?? "—" },
          ]} />
          <Pagination base="/app/crm/oportunidades" params={s} page={q.page} pageSize={q.pageSize} total={total} />
        </>
      )}
      {view === "previsao" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Previsão de fechamento (ponderada por mês)">
            <DataTable rows={m.forecast.map(([k, v]) => ({ id: k, k, v }))} columns={[{ key: "k", label: "Mês", render: (r) => (r.k === "sem data" ? "Sem data" : formatMonth(`${r.k}-01`)) }, { key: "v", label: "Ponderado", align: "right", render: (r) => formatMoney(r.v) }]} />
          </Card>
          <Card title="Vendas ganhas por responsável">
            <DataTable rows={m.byOwner.map(([k, v]) => ({ id: k, k, v }))} columns={[{ key: "k", label: "Responsável", render: (r) => users.get(r.k) ?? r.k }, { key: "v", label: "Valor", align: "right", render: (r) => formatMoney(r.v) }]} />
          </Card>
          <Card title="Vendas ganhas por cliente">
            <DataTable rows={m.byCustomer.map(([k, v]) => ({ id: k, k, v }))} columns={[{ key: "k", label: "Cliente", render: (r) => <Link className="text-brand-700 underline" href={`/app/cadastros/clientes/${r.k}`}>{parties.get(r.k) ?? "ver"}</Link> }, { key: "v", label: "Valor", align: "right", render: (r) => formatMoney(r.v) }]} />
          </Card>
          <Card title="Vendas ganhas por serviço">
            <DataTable rows={m.byService.map(([k, v]) => ({ id: k, k, v }))} columns={[{ key: "k", label: "Serviço", render: (r) => svcNames.get(r.k) ?? r.k }, { key: "v", label: "Valor", align: "right", render: (r) => formatMoney(r.v) }]} />
          </Card>
        </div>
      )}
      {view === "parados" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={`Sem atividade há mais de ${STALE_DAYS} dias`}><ul className="space-y-1 text-sm">{m.stale.map((o) => <li key={o.id}><Link className="text-brand-700 underline" href={`/app/crm/oportunidades/${o.id}`}>{o.number} {o.title}</Link> — {staleDays(o) ?? "nunca"} dia(s)</li>)}</ul></Card>
          <Card title="Próxima ação vencida"><ul className="space-y-1 text-sm">{m.overdueNextActions.map((o) => <li key={o.id}><Link className="text-brand-700 underline" href={`/app/crm/oportunidades/${o.id}`}>{o.number} {o.title}</Link> — {o.nextAction} ({formatCivil(o.nextActionDate)})</li>)}</ul></Card>
        </div>
      )}
      {view === "nova" && canWrite && <Card title="Nova oportunidade"><OpportunityForm action={createOpportunityAction} lk={lk} /></Card>}
    </>
  );
}
