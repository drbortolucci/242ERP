import Link from "next/link";
import { getTerms } from "@/modules/sectors/service";
import type { Party } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { Card, DefinitionList, Grid, Stat, StatusBadge, Badge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { formatDocument } from "@/lib/documents";
import { formatMoney, formatQty, sum, dec, money } from "@/lib/money";
import { formatCivil, formatInstant, todayIn, civil } from "@/lib/dates";
import { statusLabel } from "@/lib/labels";
import { contractBalances } from "@/modules/contracts/service";
import { userNameMap } from "@/modules/config/lookups";
import { Supplier360 } from "./supplier-360";

/**
 * Visão 360°: consolida cadastro, comercial, contratos, projetos, AMS, horas, faturamento, recebimentos,
 * interações, riscos e próximas ações. Cada indicador leva ao registro de origem.
 * Financeiro só com finance.read/billing.read; custos/margens nunca aparecem aqui sem margin.view.
 */
export async function Party360({ ctx, party, role }: { ctx: Ctx; party: Party; role: string }) {
  if (role === "fornecedores") return <Supplier360 ctx={ctx} party={party} />;
  const id = party.id;
  const can = (p: string) => ctx.permissions.has(p);
  const terms = await getTerms(ctx);
  const today = todayIn(ctx.timezone);
  const [contacts, opps, proposals, orders, contracts, projects, tickets, receivables, activities, related] = await Promise.all([
    ctx.db.contact.findMany({ where: { partyId: id, active: true } }),
    can("crm.read") ? ctx.db.opportunity.findMany({ where: { partyId: id }, orderBy: { updatedAt: "desc" } }) : [],
    can("crm.read") ? ctx.db.proposal.findMany({ where: { partyId: id }, orderBy: { updatedAt: "desc" } }) : [],
    can("contract.read") ? ctx.db.salesOrder.findMany({ where: { partyId: id } }) : [],
    can("contract.read") ? ctx.db.contract.findMany({ where: { partyId: id }, orderBy: { startDate: "desc" } }) : [],
    can("project.read") ? ctx.db.project.findMany({ where: { partyId: id } }) : [],
    can("ams.read") ? ctx.db.ticket.findMany({ where: { partyId: id }, orderBy: { openedAt: "desc" } }) : [],
    can("finance.read") ? ctx.db.receivable.findMany({ where: { partyId: id, status: { not: "CANCELED" } }, orderBy: { dueDate: "asc" } }) : [],
    ctx.db.activity.findMany({ where: { partyId: id }, orderBy: { createdAt: "desc" }, take: 15 }),
    party.document ? ctx.db.party.findMany({ where: { document: { startsWith: party.document.slice(0, 8) }, NOT: { id } } }) : [],
  ]);
  const balances = await Promise.all(contracts.filter((c) => c.status === "ACTIVE" || c.status === "ENDED").map((c) => contractBalances(ctx, c.id).then((b) => ({ id: c.id, c, b }))));
  const projectIds = projects.map((p) => p.id);
  const [timeAgg, risks, deliverables, measurements, billingDocs] = await Promise.all([
    can("project.read") && projectIds.length ? ctx.db.timeEntry.groupBy({ by: ["status"], where: { projectId: { in: projectIds } }, _sum: { hours: true } }) : [],
    can("project.read") && projectIds.length ? ctx.db.projectLog.findMany({ where: { projectId: { in: projectIds }, kind: { in: ["RISK", "ISSUE", "PENDING"] }, status: { not: "CLOSED" } } }) : [],
    can("project.read") && projectIds.length ? ctx.db.projectTask.findMany({ where: { projectId: { in: projectIds }, requiresAcceptance: true } }) : [],
    can("billing.read") ? ctx.db.measurement.findMany({ where: { partyId: id }, orderBy: { competence: "desc" }, take: 10 }) : [],
    can("billing.read") ? ctx.db.billingDocument.findMany({ where: { partyId: id }, orderBy: { issueDate: "desc" }, take: 10 }) : [],
  ]);
  const users = await userNameMap([party.ownerUserId, ...activities.map((a) => a.ownerUserId)]);
  const openOpps = opps.filter((o) => o.status === "OPEN");
  const overdue = receivables.filter((r) => ["OPEN", "PARTIAL"].includes(r.status) && r.dueDate < civil(today));
  const openRecv = receivables.filter((r) => ["OPEN", "PARTIAL"].includes(r.status));
  const openTickets = tickets.filter((t) => !["RESOLVED", "CLOSED", "CANCELED"].includes(t.status));
  const slaBreached = tickets.filter((t) => t.responseBreached || t.resolutionBreached).length;
  const csat = tickets.filter((t) => t.csatScore !== null);
  const nextActions = [
    ...openOpps.filter((o) => o.nextAction).map((o) => ({ when: o.nextActionDate ? formatCivil(o.nextActionDate) : "—", what: o.nextAction!, href: `/app/crm/oportunidades/${o.id}` })),
    ...activities.filter((a) => !a.doneAt).map((a) => ({ when: formatInstant(a.dueAt, ctx.timezone), what: a.subject, href: a.opportunityId ? `/app/crm/oportunidades/${a.opportunityId}` : "/app/crm/atividades" })),
  ];
  const a = party.address as Record<string, string>;
  return (
    <div className="space-y-6">
      <Grid cols={6}>
        {can("crm.read") && <Stat label="Pipeline aberto" value={formatMoney(sum(openOpps.map((o) => o.estimatedValue)))} hint={`${openOpps.length} oportunidade(s)`} href="/app/crm/oportunidades?view=lista&status=OPEN" />}
        {can("contract.read") && <Stat label="Contratado" value={formatMoney(sum(balances.map((x) => x.b.contracted)))} hint={`${contracts.length} contrato(s)`} href="#contratos" />}
        {can("contract.read") && <Stat label="Executado não faturado" value={formatMoney(sum(balances.map((x) => x.b.unbilled)))} tone="warn" href="/app/faturamento/pendencias" />}
        {can("finance.read") && <Stat label="Em aberto a receber" value={formatMoney(sum(openRecv.map((r) => r.openAmount)))} href="#financeiro" />}
        {can("finance.read") && <Stat label="Inadimplência" value={formatMoney(sum(overdue.map((r) => r.openAmount)))} tone={overdue.length ? "bad" : "good"} hint={`${overdue.length} título(s) vencido(s)`} href="#financeiro" />}
        {can("ams.read") && <Stat label="Chamados abertos" value={openTickets.length} hint={`${slaBreached} com SLA violado · satisfação ${csat.length ? (csat.reduce((s, t) => s + (t.csatScore ?? 0), 0) / csat.length).toFixed(1) : "—"}`} href={`/app/ams/chamados?cliente=${id}`} tone={slaBreached ? "warn" : "default"} />}
      </Grid>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Cadastro e relacionamento">
          <DefinitionList items={[{ label: "Documento", value: formatDocument(party.document) }, { label: "Segmento", value: party.segment }, { label: "Cidade/UF", value: [a.city, a.state].filter(Boolean).join("/") || "—" }, { label: "Responsável interno", value: users.get(party.ownerUserId ?? "") }, { label: "E-mail", value: party.email }, { label: "Telefone", value: party.phone }]} />
          {related.length > 0 && <p className="mt-3 text-xs text-slate-600">Empresas relacionadas (mesma raiz de CNPJ): {related.map((r) => <Link key={r.id} className="mr-2 text-brand-700 underline" href={`/app/cadastros/clientes/${r.id}`}>{r.name}</Link>)}</p>}
          <h3 className="mb-1 mt-4 text-sm font-semibold">Contatos e responsáveis</h3>
          <ul className="text-sm">{contacts.map((c) => <li key={c.id}>{c.name} <span className="text-xs text-slate-500">{c.jobTitle} · {c.roles.join(", ")}</span></li>)}</ul>
        </Card>
        <Card title="Próximas ações">
          {nextActions.length ? <ul className="space-y-1 text-sm">{nextActions.slice(0, 10).map((n, i) => <li key={i}><Link className="text-brand-700 underline" href={n.href}>{n.what}</Link> <span className="text-xs text-slate-500">{n.when}</span></li>)}</ul> : <p className="text-sm text-slate-500">Nenhuma próxima ação registrada.</p>}
          <h3 className="mb-1 mt-4 text-sm font-semibold">Pendências e riscos</h3>
          {risks.length ? <ul className="space-y-1 text-sm">{risks.map((r) => <li key={r.id}><Badge tone={r.kind === "RISK" ? "amber" : "red"}>{r.kind === "RISK" ? "Risco" : r.kind === "ISSUE" ? "Problema" : "Pendência"}</Badge> <Link className="text-brand-700 underline" href={`/app/projetos/${r.projectId}?tab=riscos`}>{r.title}</Link></li>)}</ul> : <p className="text-sm text-slate-500">Nenhum risco aberto.</p>}
        </Card>
        <Card title="Interações e decisões">
          {activities.length ? <ul className="space-y-1 text-sm">{activities.map((x) => <li key={x.id}><b>{x.subject}</b> <span className="text-xs text-slate-500">{x.type} · {formatInstant(x.doneAt ?? x.createdAt, ctx.timezone)} · {users.get(x.ownerUserId ?? "")}</span></li>)}</ul> : <p className="text-sm text-slate-500">Sem interações.</p>}
        </Card>
      </div>

      {can("crm.read") && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Histórico comercial — oportunidades">
            <DataTable dense rows={opps} rowHref={(o) => `/app/crm/oportunidades/${o.id}`} columns={[{ key: "number", label: "Nº" }, { key: "title", label: "Título" }, { key: "kind", label: "Tipo", render: (o) => statusLabel(o.kind) }, { key: "v", label: "Valor", align: "right", render: (o) => formatMoney(o.estimatedValue) }, { key: "status", label: "Situação", render: (o) => <StatusBadge status={o.status} /> }]} empty={<p className="text-sm text-slate-500">Nenhuma.</p>} />
          </Card>
          <Card title="Propostas e pedidos">
            <DataTable dense rows={proposals} rowHref={(p) => `/app/propostas/${p.id}`} columns={[{ key: "number", label: "Proposta" }, { key: "title", label: "Título" }, { key: "v", label: "Versão", render: (p) => `v${p.currentVersion}` }, { key: "status", label: "Situação", render: (p) => <StatusBadge status={p.status} /> }]} empty={<p className="text-sm text-slate-500">Nenhuma.</p>} />
            {orders.length > 0 && <p className="mt-2 text-sm">Pedidos: {orders.map((o) => <Link key={o.id} className="mr-2 text-brand-700 underline" href={`/app/pedidos/${o.id}`}>{o.number}</Link>)}</p>}
          </Card>
        </div>
      )}

      {can("contract.read") && (
        <div id="contratos">
          <Card title="Contratos">
            <DataTable dense rows={balances} rowHref={(x) => `/app/contratos/${x.c.id}`} columns={[{ key: "n", label: "Contrato", render: (x) => `${x.c.number} — ${x.c.title}` }, { key: "m", label: "Modelo", render: (x) => statusLabel(x.c.commercialModel) }, { key: "ct", label: "Contratado", align: "right", render: (x) => formatMoney(x.b.contracted) }, { key: "ex", label: "Executado", align: "right", render: (x) => formatMoney(x.b.executed) }, { key: "fa", label: "Faturado", align: "right", render: (x) => formatMoney(x.b.billed) }, { key: "re", label: "Recebido", align: "right", render: (x) => formatMoney(x.b.received) }, { key: "sa", label: "Saldo", align: "right", render: (x) => formatMoney(x.b.available) }, { key: "st", label: "Situação", render: (x) => <StatusBadge status={x.c.status} /> }]} empty={<p className="text-sm text-slate-500">Nenhum contrato ativo.</p>} />
          </Card>
        </div>
      )}

      {can("project.read") && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Projetos, equipes e horas">
            <DataTable dense rows={projects} rowHref={(p) => `/app/projetos/${p.id}`} columns={[{ key: "code", label: "Código" }, { key: "name", label: "Projeto" }, { key: "status", label: "Situação", render: (p) => <StatusBadge status={p.status} /> }]} empty={<p className="text-sm text-slate-500">Nenhum projeto.</p>} />
            <p className="mt-2 text-xs text-slate-600">Horas: {timeAgg.map((t) => `${statusLabel(t.status)} ${formatQty(t._sum.hours ?? 0)}h`).join(" · ") || "—"}</p>
          </Card>
          <Card title="Entregáveis e aceites">
            <DataTable dense rows={deliverables} columns={[{ key: "name", label: "Entregável" }, { key: "acc", label: "Aceite", render: (d) => <StatusBadge status={d.acceptanceStatus ?? "PENDING"} /> }, { key: "by", label: "Por", render: (d) => d.acceptedByName ?? "—" }]} empty={<p className="text-sm text-slate-500">Nenhum entregável com aceite.</p>} />
          </Card>
        </div>
      )}

      {can("ams.read") && tickets.length > 0 && (
        <Card title={`${terms.tickets} e nível de serviço`}>
          <DataTable dense rows={tickets.slice(0, 15)} rowHref={(t) => `/app/ams/chamados/${t.id}`} columns={[{ key: "number", label: "Nº" }, { key: "title", label: "Título" }, { key: "priority", label: "Prioridade" }, { key: "status", label: "Situação", render: (t) => <StatusBadge status={t.status} /> }, { key: "sla", label: "SLA", render: (t) => (t.responseBreached || t.resolutionBreached ? <Badge tone="red">Violado</Badge> : <Badge tone="green">Dentro</Badge>) }, { key: "csat", label: "Satisfação", render: (t) => t.csatScore ?? "—" }]} />
        </Card>
      )}

      {(can("billing.read") || can("finance.read")) && (
        <div className="grid gap-6 lg:grid-cols-2" id="financeiro">
          {can("billing.read") && (
            <Card title="Medições e faturamento">
              <DataTable dense rows={measurements} rowHref={(m) => `/app/faturamento/medicoes/${m.id}`} columns={[{ key: "number", label: "Medição" }, { key: "c", label: "Competência", render: (m) => formatCivil(m.competence) }, { key: "t", label: "Total", align: "right", render: (m) => formatMoney(m.totalAmount) }, { key: "s", label: "Situação", render: (m) => <StatusBadge status={m.status} /> }]} empty={<p className="text-sm text-slate-500">Nenhuma medição.</p>} />
              {billingDocs.length > 0 && <div className="mt-3"><DataTable dense rows={billingDocs} rowHref={(d) => `/app/faturamento/cobrancas/${d.id}`} columns={[{ key: "number", label: "Cobrança" }, { key: "i", label: "Emissão", render: (d) => formatCivil(d.issueDate) }, { key: "n", label: "Líquido", align: "right", render: (d) => formatMoney(d.netAmount) }, { key: "s", label: "Situação", render: (d) => <StatusBadge status={d.status} /> }]} /></div>}
            </Card>
          )}
          {can("finance.read") && (
            <Card title="Recebimentos e inadimplência">
              <DataTable dense rows={receivables.slice(0, 20)} rowHref={(r) => `/app/financeiro/titulos/receber/${r.id}`} columns={[{ key: "number", label: "Título" }, { key: "d", label: "Vencimento", render: (r) => <span className={overdue.includes(r) ? "font-medium text-red-700" : ""}>{formatCivil(r.dueDate)}</span> }, { key: "a", label: "Valor", align: "right", render: (r) => formatMoney(r.amount) }, { key: "o", label: "Em aberto", align: "right", render: (r) => formatMoney(r.openAmount) }, { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> }]} empty={<p className="text-sm text-slate-500">Nenhum título.</p>} />
              <p className="mt-2 text-xs text-slate-600">Recebido total: {formatMoney(money(sum(receivables.map((r) => dec(r.amount).minus(dec(r.openAmount))))))}</p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
