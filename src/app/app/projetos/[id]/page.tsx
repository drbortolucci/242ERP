import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card, DefinitionList, StatusBadge, Tabs, Grid, Stat, Badge, Notice } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionButton, ActionForm, Checkbox, FormGrid, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { projectAnalytics, type ProjectAnalytics } from "@/modules/projects/analytics";
import { lookups, nameMap, userNameMap } from "@/modules/config/lookups";
import { Attachments } from "@/components/attachments";
import { formatMoney, formatPct, formatQty, dec } from "@/lib/money";
import { civil, formatCivil, formatInstant, toCivil, todayIn } from "@/lib/dates";
import { statusLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import * as A from "../actions";

const RAG = [{ value: "GREEN", label: "Verde" }, { value: "YELLOW", label: "Amarelo" }, { value: "RED", label: "Vermelho" }];

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; view?: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  pagePerm(ctx, "project.read");
  const an = await projectAnalytics(ctx, id);
  if (!an) notFound();
  const p = an.project;
  const sp = await searchParams;
  const tab = sp.tab ?? "painel";
  const base = `/app/projetos/${id}`;
  const canWrite = ctx.permissions.has("project.write");
  const showMoney = ctx.permissions.has("margin.view");
  const [party, contract, users] = await Promise.all([ctx.db.party.findFirst({ where: { id: p.partyId } }), p.contractId ? ctx.db.contract.findFirst({ where: { id: p.contractId } }) : null, userNameMap([p.managerUserId])]);
  const tabs = [["painel", "Painel"], ["wbs", "Escopo e cronograma"], ["equipe", "Equipe e recursos"], ["riscos", "Riscos, problemas e decisões"], ["status", "Relatórios de status"], ["baseline", "Linha de base"], ["estimativa", "Estimativa e previsão"], ["financeiro", "Compras, despesas e faturamento"], ["docs", "Documentos"], ["encerramento", "Encerramento"]];
  return (
    <>
      <PageHeader title={`${p.code} — ${p.name}`} subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={p.status} /> Financeiro: <StatusBadge status={p.financialStatus} /> · <Link className="text-brand-700 underline" href={`/app/cadastros/clientes/${p.partyId}`}>{party?.name}</Link> {contract && <>· <Link className="text-brand-700 underline" href={`/app/contratos/${contract.id}`}>{contract.number}</Link></>} · Gestor: {users.get(p.managerUserId ?? "") ?? "—"}</span>}
        breadcrumbs={[{ label: "Projetos", href: "/app/projetos" }, { label: p.code }]}
        actions={canWrite && p.status !== "COMPLETED" && p.status !== "CANCELED" && <>
          {p.status === "PLANNING" && <ActionButton action={A.updateProjectAction} fields={{ id, status: "ACTIVE" }} variant="primary">Iniciar execução</ActionButton>}
          {p.status === "ACTIVE" && <ActionButton action={A.updateProjectAction} fields={{ id, status: "ON_HOLD" }}>Pausar</ActionButton>}
          {p.status === "ON_HOLD" && <ActionButton action={A.updateProjectAction} fields={{ id, status: "ACTIVE" }}>Retomar</ActionButton>}
        </>} />
      <Tabs active={tab} tabs={tabs.map(([k, l]) => ({ key: k, label: l, href: `${base}?tab=${k}` }))} />
      {tab === "painel" && <Painel an={an} showMoney={showMoney} />}
      {tab === "wbs" && <Wbs view={sp.view ?? "lista"} />}
      {tab === "equipe" && <Equipe />}
      {tab === "riscos" && <Riscos />}
      {tab === "status" && <Status />}
      {tab === "baseline" && <Baseline />}
      {tab === "estimativa" && <Estimativa />}
      {tab === "financeiro" && <Financeiro />}
      {tab === "docs" && <Attachments ctx={ctx} entity="Project" entityId={id} back={`${base}?tab=docs`} canUpload={canWrite} allowClientVisibility />}
      {tab === "encerramento" && <Encerramento />}
    </>
  );

  function Painel({ an, showMoney }: { an: ProjectAnalytics; showMoney: boolean }) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {an.flags.late && <Badge tone="amber">Atraso ({an.flags.overdueTasks} atividade(s) vencidas)</Badge>}
          {an.flags.overBudget && <Badge tone="red">Estouro de orçamento previsto</Badge>}
          {an.flags.lowMargin && <Badge tone="red">Margem prevista baixa</Badge>}
          {an.flags.pendingAcceptance > 0 && <Badge tone="amber">{an.flags.pendingAcceptance} entregável(is) sem aceite</Badge>}
          {an.flags.unbilled.gt(0) && <Badge tone="violet">Execução não faturada: {formatMoney(an.flags.unbilled)}</Badge>}
        </div>
        <Grid cols={4}>
          <Stat label={`Avanço (${({ HOURS: "horas", MILESTONES: "marcos", TASK_WEIGHT: "peso de atividades", MANUAL: "manual" } as Record<string, string>)[p.progressMethod]})`} value={formatPct(an.progress)} hint="Critério explícito definido no projeto" />
          <Stat label="Horas realizadas / planejadas" value={`${formatQty(an.actualHours)} / ${formatQty(an.plannedHours)}`} hint={formatPct(an.hoursPct)} href={`/app/horas?projeto=${id}`} />
          {showMoney && <Stat label="Custo realizado" value={formatMoney(an.actualCost)} hint={`Pessoal ${formatMoney(an.laborCost)} · Terceiros ${formatMoney(an.thirdPartyCost)} · Despesas ${formatMoney(an.expenseCost)}`} />}
          {showMoney && <Stat label="Comprometido não realizado" value={formatMoney(an.committedNotRealized)} hint="Pedidos de compra aprovados ainda não faturados" href={`${base}?tab=financeiro`} />}
          {showMoney && <Stat label="Orçamento de custo (vigente)" value={formatMoney(an.bac)} hint={`Linha de base v${an.current?.version ?? "—"}`} />}
          {showMoney && <Stat label="Custo previsto ao término (EAC)" value={formatMoney(an.forecast.cost)} tone={an.flags.overBudget ? "bad" : "default"} />}
          {showMoney && <Stat label="Receita prevista" value={formatMoney(an.forecast.revenue)} hint={`Reconhecida: ${formatMoney(an.recognizedRevenue)}`} />}
          {showMoney && <Stat label="Margem prevista" value={`${formatMoney(an.forecast.margin)} (${formatPct(an.forecast.marginPct)})`} tone={an.flags.lowMargin ? "bad" : "good"} />}
        </Grid>
        {showMoney && (
          <Card title="Valor agregado (EVM)">
            {an.evm ? (
              <DefinitionList items={[{ label: "Valor planejado (PV)", value: formatMoney(an.evm.pv) }, { label: "Valor agregado (EV)", value: formatMoney(an.evm.ev) }, { label: "Custo real (AC)", value: formatMoney(an.evm.ac) }, { label: "SPI (EV ÷ PV)", value: an.evm.spi.toString() }, { label: "CPI (EV ÷ AC)", value: an.evm.cpi?.toString() ?? "—" }]} />
            ) : <Notice tone="info">EVM não exibido: requer linha de base com distribuição mensal, custo planejado até a data e critério de avanço objetivo (não manual). Nenhum valor é estimado artificialmente.</Notice>}
          </Card>
        )}
      </div>
    );
  }

  async function Wbs({ view }: { view: string }) {
    const [tasks, deps, profs] = await Promise.all([ctx.db.projectTask.findMany({ where: { projectId: id }, orderBy: [{ sortOrder: "asc" }, { wbsCode: "asc" }] }), ctx.db.taskDependency.findMany({ where: { predecessorId: { in: (await ctx.db.projectTask.findMany({ where: { projectId: id } })).map((t) => t.id) } } }), lookups.professionals(ctx)]);
    const hoursByTask = await ctx.db.timeEntry.groupBy({ by: ["taskId"], where: { projectId: id, status: "APPROVED" }, _sum: { hours: true } });
    const hb = new Map(hoursByTask.map((h) => [h.taskId, h._sum.hours]));
    const pn = new Map(profs.map((x) => [x.value, x.label]));
    const tOpts = tasks.map((t) => ({ value: t.id, label: `${t.wbsCode} ${t.name}` }));
    const sorted = [...tasks].sort((a, b) => a.wbsCode.localeCompare(b.wbsCode, undefined, { numeric: true }));
    const today = todayIn(ctx.timezone);
    return (
      <div className="space-y-6">
        <Tabs active={view} tabs={[{ key: "lista", label: "WBS", href: `${base}?tab=wbs&view=lista` }, { key: "kanban", label: "Kanban", href: `${base}?tab=wbs&view=kanban` }, { key: "gantt", label: "Cronograma (Gantt)", href: `${base}?tab=wbs&view=gantt` }]} />
        {view === "lista" && (
          <DataTable dense rows={sorted} columns={[
            { key: "wbsCode", label: "WBS", render: (t) => <span style={{ paddingLeft: `${(t.wbsCode.split(".").length - 1) * 12}px` }} className={t.kind === "PHASE" ? "font-semibold" : ""}>{t.wbsCode} {t.name}</span> },
            { key: "kind", label: "Tipo", render: (t) => ({ PHASE: "Fase", DELIVERABLE: "Entregável", TASK: "Atividade", MILESTONE: "Marco" })[t.kind] },
            { key: "dates", label: "Planejado", render: (t) => `${formatCivil(t.plannedStart)} – ${formatCivil(t.plannedEnd)}` },
            { key: "real", label: "Realizado", render: (t) => t.actualStart ? `${formatCivil(t.actualStart)} – ${formatCivil(t.actualEnd)}` : "—" },
            { key: "h", label: "Horas real./plan.", align: "right", render: (t) => `${formatQty(hb.get(t.id) ?? 0)} / ${formatQty(t.plannedHours)}` },
            { key: "who", label: "Responsável", render: (t) => pn.get(t.assigneeProfessionalId ?? "") ?? "—" },
            { key: "deps", label: "Depende de", render: (t) => deps.filter((d) => d.successorId === t.id).map((d) => tasks.find((x) => x.id === d.predecessorId)?.wbsCode).join(", ") || "—" },
            { key: "status", label: "Situação", render: (t) => t.kind === "PHASE" ? "" : <StatusBadge status={t.status} /> },
            { key: "acc", label: "Aceite", render: (t) => t.requiresAcceptance ? <StatusBadge status={t.acceptanceStatus ?? "PENDING"} /> : "" },
            { key: "act", label: "", render: (t) => canWrite && t.kind !== "PHASE" && (
              <div className="flex flex-wrap gap-1">
                {t.status !== "DONE" && <ActionButton action={A.taskStatusAction} fields={{ id: t.id, status: t.status === "TODO" ? "IN_PROGRESS" : "DONE", back: `${base}?tab=wbs` }}>{t.status === "TODO" ? "Iniciar" : "Concluir"}</ActionButton>}
                {t.requiresAcceptance && t.acceptanceStatus !== "ACCEPTED" && t.status === "DONE" && (
                  <details><summary className="cursor-pointer text-xs text-brand-700">Registrar aceite</summary>
                    <ActionForm action={A.deliverableAction}><input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="back" value={`${base}?tab=wbs`} /><Input name="byName" label="Aceito por (cliente)" required /><Input name="comment" label="Comentário/evidência" /><div className="flex gap-1"><SubmitButton name="accept" value="1">Aceitar</SubmitButton><SubmitButton name="accept" value="0" variant="danger">Recusar</SubmitButton></div></ActionForm>
                  </details>
                )}
              </div>
            ) },
          ]} />
        )}
        {view === "kanban" && (
          <div className="grid gap-3 md:grid-cols-4">
            {(["TODO", "IN_PROGRESS", "BLOCKED", "DONE"] as const).map((st) => (
              <section key={st} className="rounded-lg bg-slate-200/60 p-2" aria-label={statusLabel(st)}>
                <h2 className="mb-2 px-1 text-sm font-semibold">{statusLabel(st)}</h2>
                <ul className="space-y-2">{tasks.filter((t) => t.kind !== "PHASE" && t.status === st).map((t) => (
                  <li key={t.id} className="rounded bg-white p-2 text-sm shadow-sm">
                    <b>{t.wbsCode}</b> {t.name}<div className="text-xs text-slate-500">{pn.get(t.assigneeProfessionalId ?? "") ?? "sem responsável"} · até {formatCivil(t.plannedEnd)}</div>
                    {canWrite && <div className="mt-1 flex flex-wrap gap-1">{(["TODO", "IN_PROGRESS", "BLOCKED", "DONE"] as const).filter((x) => x !== st).map((x) => <ActionButton key={x} action={A.taskStatusAction} fields={{ id: t.id, status: x, back: `${base}?tab=wbs&view=kanban` }}>{statusLabel(x)}</ActionButton>)}</div>}
                  </li>
                ))}</ul>
              </section>
            ))}
          </div>
        )}
        {view === "gantt" && <Gantt tasks={sorted} today={today} />}
        {canWrite && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Nova atividade / entregável / marco">
              <ActionForm action={A.saveTaskAction} resetOnSuccess>
                <input type="hidden" name="projectId" value={id} />
                <FormGrid cols={2}>
                  <Input name="name" label="Nome" required /><Select name="kind" label="Tipo" options={[{ value: "TASK", label: "Atividade" }, { value: "DELIVERABLE", label: "Entregável" }, { value: "MILESTONE", label: "Marco" }, { value: "PHASE", label: "Fase" }]} />
                  <Select name="parentId" label="Item pai (WBS)" options={tOpts} placeholder="(raiz)" /><Select name="assigneeProfessionalId" label="Responsável" options={profs} placeholder="—" />
                  <Input name="plannedStart" type="date" label="Início planejado" /><Input name="plannedEnd" type="date" label="Término planejado" />
                  <Input name="plannedHours" label="Horas planejadas" defaultValue="0" /><Input name="weight" label="Peso (avanço)" defaultValue="1" />
                </FormGrid>
                <Checkbox name="requiresAcceptance" label="Exige aceite do cliente" />
                <SubmitButton variant="secondary">Incluir</SubmitButton>
              </ActionForm>
            </Card>
            <Card title="Dependência (término → início)">
              <ActionForm action={A.dependencyAction} resetOnSuccess><input type="hidden" name="back" value={`${base}?tab=wbs`} /><Select name="predecessorId" label="Predecessora" options={tOpts} required /><Select name="successorId" label="Sucessora" options={tOpts} required /><SubmitButton variant="secondary">Criar dependência</SubmitButton></ActionForm>
            </Card>
          </div>
        )}
      </div>
    );
  }

  async function Equipe() {
    const [members, allocs, reqs, profs, roles, sens, skills] = await Promise.all([ctx.db.projectMember.findMany({ where: { projectId: id } }), ctx.db.allocation.findMany({ where: { projectId: id, status: { not: "CANCELED" } }, orderBy: { startDate: "asc" } }), ctx.db.resourceRequest.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" } }), lookups.professionals(ctx), lookups.teamRoles(ctx), lookups.seniorities(ctx), lookups.skills(ctx)]);
    const pn = new Map(profs.map((x) => [x.value, x.label]));
    const rn = new Map(roles.map((x) => [x.value, x.label]));
    const hours = await ctx.db.timeEntry.groupBy({ by: ["professionalId"], where: { projectId: id, status: { in: ["APPROVED", "SUBMITTED"] } }, _sum: { hours: true } });
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Equipe e responsabilidades">
          <DataTable dense rows={members} columns={[{ key: "p", label: "Profissional", render: (m) => pn.get(m.professionalId) }, { key: "r", label: "Papel", render: (m) => rn.get(m.teamRoleId ?? "") ?? "—" }, { key: "resp", label: "Responsabilidade", render: (m) => m.responsibility ?? "—" }, { key: "h", label: "Horas apontadas", align: "right", render: (m) => formatQty(hours.find((h) => h.professionalId === m.professionalId)?._sum.hours ?? 0) }]} empty={<p className="text-sm text-slate-500">Sem equipe.</p>} />
          {canWrite && <ActionForm action={A.memberAction} resetOnSuccess className="mt-3"><input type="hidden" name="projectId" value={id} /><FormGrid cols={3}><Select name="professionalId" label="Profissional" options={profs} required /><Select name="teamRoleId" label="Papel" options={roles} placeholder="—" /><Input name="responsibility" label="Responsabilidade" /></FormGrid><SubmitButton variant="secondary">Incluir na equipe</SubmitButton></ActionForm>}
        </Card>
        <Card title="Alocações" actions={<Link className="text-sm text-brand-700 underline" href={`/app/recursos?projeto=${id}`}>Planejar alocação</Link>}>
          <DataTable dense rows={allocs} columns={[{ key: "p", label: "Profissional", render: (a) => pn.get(a.professionalId) }, { key: "per", label: "Período", render: (a) => `${formatCivil(a.startDate)} – ${formatCivil(a.endDate)}` }, { key: "v", label: "Alocação", render: (a) => `${a.mode === "PERCENT" ? `${a.value}%` : a.mode === "HOURS_PER_DAY" ? `${a.value}h/dia` : `${a.value}h`}` }, { key: "t", label: "Horas", align: "right", render: (a) => formatQty(a.totalHours) }, { key: "s", label: "Situação", render: (a) => <StatusBadge status={a.status} /> }]} empty={<p className="text-sm text-slate-500">Sem alocações.</p>} />
        </Card>
        <Card title="Solicitações de recursos" className="lg:col-span-2">
          <DataTable dense rows={reqs} columns={[{ key: "r", label: "Perfil", render: (r) => [rn.get(r.teamRoleId ?? ""), sens.find((s) => s.value === r.seniorityId)?.label].filter(Boolean).join(" · ") || "—" }, { key: "h", label: "Horas", align: "right", render: (r) => formatQty(r.hours) }, { key: "p", label: "Período", render: (r) => `${formatCivil(r.startDate)} – ${formatCivil(r.endDate)}` }, { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> }, { key: "a", label: "", render: (r) => r.status === "OPEN" && <Link className="text-sm text-brand-700 underline" href={`/app/recursos?solicitacao=${r.id}`}>Atender</Link> }]} empty={<p className="text-sm text-slate-500">Nenhuma.</p>} />
          {canWrite && <ActionForm action={A.resourceRequestAction} resetOnSuccess className="mt-3"><input type="hidden" name="projectId" value={id} /><FormGrid cols={4}><Select name="teamRoleId" label="Papel" options={roles} placeholder="—" /><Select name="seniorityId" label="Senioridade" options={sens} placeholder="—" /><Input name="hours" label="Horas" required /><Input name="startDate" type="date" label="De" required /><Input name="endDate" type="date" label="Até" required /><Input name="notes" label="Observações" /></FormGrid><fieldset className="grid gap-1 md:grid-cols-4"><legend className="text-xs font-medium">Competências exigidas</legend>{skills.map((s) => <Checkbox key={s.value} name="skillIds[]" value={s.value} label={s.label} />)}</fieldset><SubmitButton variant="secondary">Solicitar recurso</SubmitButton></ActionForm>}
        </Card>
      </div>
    );
  }

  async function Riscos() {
    const logs = await ctx.db.projectLog.findMany({ where: { projectId: id }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
    const kinds = { RISK: "Risco", ISSUE: "Problema", DECISION: "Decisão", PENDING: "Pendência", CHANGE: "Mudança" } as Record<string, string>;
    const crs = await ctx.db.changeRequest.findMany({ where: { projectId: id } });
    return (
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <DataTable rows={logs} columns={[{ key: "k", label: "Tipo", render: (l) => <Badge tone={l.kind === "RISK" ? "amber" : l.kind === "ISSUE" ? "red" : l.kind === "DECISION" ? "blue" : "slate"}>{kinds[l.kind]}</Badge> }, { key: "title", label: "Título", render: (l) => <span>{l.title}{l.description && <span className="block text-xs text-slate-500">{l.description}</span>}</span> }, { key: "pi", label: "P×I", render: (l) => (l.probability && l.impact ? l.probability * l.impact : "—") }, { key: "o", label: "Responsável", render: (l) => l.ownerName ?? "—" }, { key: "d", label: "Prazo", render: (l) => formatCivil(l.dueDate) }, { key: "s", label: "Situação", render: (l) => <StatusBadge status={l.status} /> }, { key: "a", label: "", render: (l) => canWrite && l.status !== "CLOSED" && <ActionButton action={A.logStatusAction} fields={{ id: l.id, status: "CLOSED", back: `${base}?tab=riscos` }}>Encerrar</ActionButton> }]} empty={<p className="text-sm text-slate-500">Nenhum registro.</p>} />
          <Card title="Solicitações de mudança vinculadas">{crs.length ? <ul className="text-sm">{crs.map((c) => <li key={c.id}>{c.title} — <StatusBadge status={c.status} /></li>)}</ul> : <p className="text-sm text-slate-500">Nenhuma. Registre no contrato (aba Aditivos e mudanças).</p>}</Card>
        </div>
        {canWrite && <Card title="Novo registro"><ActionForm action={A.logAction} resetOnSuccess><input type="hidden" name="projectId" value={id} /><Select name="kind" label="Tipo" options={Object.entries(kinds).map(([value, label]) => ({ value, label }))} /><Input name="title" label="Título" required /><Textarea name="description" label="Descrição / plano de ação" /><FormGrid cols={2}><Input name="probability" type="number" label="Probabilidade (1-5)" /><Input name="impact" type="number" label="Impacto (1-5)" /><Input name="ownerName" label="Responsável" /><Input name="dueDate" type="date" label="Prazo" /></FormGrid><Checkbox name="clientVisible" label="Visível ao cliente no portal" /><SubmitButton variant="secondary">Registrar</SubmitButton></ActionForm></Card>}
      </div>
    );
  }

  async function Status() {
    const reps = await ctx.db.statusReport.findMany({ where: { projectId: id }, orderBy: { reportDate: "desc" } });
    const dot = (v: string) => <span className={cn("inline-block h-3 w-3 rounded-full", v === "GREEN" ? "bg-emerald-500" : v === "YELLOW" ? "bg-amber-400" : "bg-red-500")} aria-label={statusLabel(v)} />;
    return (
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">{reps.length === 0 ? <p className="text-sm text-slate-500">Nenhum relatório.</p> : reps.map((r) => (
          <Card key={r.id} title={<span className="flex items-center gap-2">{dot(r.overall)} Status de {formatCivil(r.reportDate)}{r.clientVisible && <Badge>visível ao cliente</Badge>}</span>}>
            <p className="text-xs text-slate-600">Prazo {dot(r.schedule)} · Orçamento {dot(r.budget)} · Escopo {dot(r.scope)}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{r.summary}</p>{r.nextSteps && <p className="mt-2 text-sm"><b>Próximos passos:</b> {r.nextSteps}</p>}
          </Card>
        ))}</div>
        {canWrite && <Card title="Novo relatório de status"><ActionForm action={A.statusReportAction} resetOnSuccess><input type="hidden" name="projectId" value={id} /><FormGrid cols={2}><Select name="overall" label="Geral" options={RAG} /><Select name="schedule" label="Prazo" options={RAG} /><Select name="budget" label="Orçamento" options={RAG} /><Select name="scope" label="Escopo" options={RAG} /></FormGrid><Textarea name="summary" label="Resumo" required /><Textarea name="nextSteps" label="Próximos passos" /><Checkbox name="clientVisible" label="Publicar no portal do cliente" defaultChecked /><SubmitButton>Registrar</SubmitButton></ActionForm></Card>}
      </div>
    );
  }

  async function Baseline() {
    const bls = an!.baselines;
    const cur = an!.current;
    return (
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Versões da linha de base (escopo, prazo, esforço, receita e custo)" className="lg:col-span-2">
          <DataTable dense rows={bls} columns={[{ key: "v", label: "Versão", render: (b) => `v${b.version} — ${b.label}` }, { key: "p", label: "Prazo", render: (b) => `${formatCivil(b.plannedStart)} – ${formatCivil(b.plannedEnd)}` }, { key: "h", label: "Esforço", align: "right", render: (b) => formatQty(b.effortHours) }, ...(showMoney ? [{ key: "r", label: "Receita", align: "right" as const, render: (b: (typeof bls)[number]) => formatMoney(b.revenue) }, { key: "c", label: "Custo total", align: "right" as const, render: (b: (typeof bls)[number]) => formatMoney(dec(b.laborCost).plus(b.thirdPartyCost).plus(b.expenseCost).plus(b.otherCost)) }] : []), { key: "reason", label: "Motivo", render: (b) => b.reason ?? "—" }, { key: "d", label: "Registrada", render: (b) => formatInstant(b.createdAt, ctx.timezone) }]} />
        </Card>
        {ctx.permissions.has("project.baseline") && cur && (
          <Card title="Revisar linha de base">
            <ActionForm action={A.baselineAction}><input type="hidden" name="projectId" value={id} /><Input name="label" label="Rótulo" defaultValue={`Revisão ${cur.version}`} required /><Input name="reason" label="Motivo (aditivo, replanejamento…)" required /><FormGrid cols={2}><Input name="plannedStart" type="date" label="Início" defaultValue={cur.plannedStart ? toCivil(cur.plannedStart) : ""} required /><Input name="plannedEnd" type="date" label="Término" defaultValue={cur.plannedEnd ? toCivil(cur.plannedEnd) : ""} required /><Input name="effortHours" label="Esforço (h)" defaultValue={cur.effortHours.toString()} /><Input name="revenue" label="Receita" defaultValue={cur.revenue.toString()} /><Input name="laborCost" label="Custo pessoal" defaultValue={cur.laborCost.toString()} /><Input name="thirdPartyCost" label="Terceiros" defaultValue={cur.thirdPartyCost.toString()} /><Input name="expenseCost" label="Despesas" defaultValue={cur.expenseCost.toString()} /></FormGrid><SubmitButton>Registrar nova versão</SubmitButton></ActionForm>
          </Card>
        )}
      </div>
    );
  }

  async function Estimativa() {
    const ests = await ctx.db.projectEstimate.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" } });
    const f = an!.forecast;
    return (
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Previsão ao término" className="lg:col-span-2">
          {showMoney ? <DefinitionList items={[{ label: "Custo realizado", value: formatMoney(an!.actualCost) }, { label: "Comprometido não realizado (compras)", value: formatMoney(an!.committedNotRealized) }, { label: "Estimativa para concluir (ETC)", value: formatMoney(f.etc) }, { label: "Custo previsto (EAC)", value: formatMoney(f.cost) }, { label: "Receita prevista", value: formatMoney(f.revenue) }, { label: "Margem prevista", value: `${formatMoney(f.margin)} (${formatPct(f.marginPct)})` }]} /> : <Notice tone="info">Valores restritos.</Notice>}
          <p className="mt-3 text-xs text-slate-500">EAC = realizado + comprometido não realizado + ETC (pessoal + terceiros ainda não contratados + despesas). Compromissos já registrados não entram novamente no ETC. {an!.estimate ? `Última estimativa em ${formatCivil(an!.estimate.asOf)}.` : "Sem estimativa registrada: ETC de pessoal calculado pelas horas restantes da linha de base × custo médio realizado."}</p>
          <h3 className="mb-2 mt-4 text-sm font-semibold">Histórico de estimativas</h3>
          <DataTable dense rows={ests} columns={[{ key: "d", label: "Data", render: (e) => formatCivil(e.asOf) }, { key: "h", label: "Horas restantes", align: "right", render: (e) => formatQty(e.remainingHours) }, ...(showMoney ? [{ key: "l", label: "Pessoal", align: "right" as const, render: (e: (typeof ests)[number]) => formatMoney(e.remainingLaborCost) }, { key: "t", label: "Terceiros não comprometidos", align: "right" as const, render: (e: (typeof ests)[number]) => formatMoney(e.remainingThirdPartyUncommitted) }, { key: "x", label: "Despesas", align: "right" as const, render: (e: (typeof ests)[number]) => formatMoney(e.remainingExpenses) }, { key: "r", label: "Receita restante", align: "right" as const, render: (e: (typeof ests)[number]) => formatMoney(e.remainingRevenue) }] : []), { key: "n", label: "Notas", render: (e) => e.notes ?? "—" }]} empty={<p className="text-sm text-slate-500">Nenhuma.</p>} />
        </Card>
        {canWrite && showMoney && <Card title="Nova estimativa para concluir"><ActionForm action={A.estimateAction}><input type="hidden" name="projectId" value={id} /><Input name="remainingHours" label="Horas restantes" required /><Input name="remainingLaborCost" label="Custo de pessoal restante" required /><Input name="remainingThirdPartyUncommitted" label="Terceiros ainda NÃO contratados" defaultValue="0" /><Input name="remainingExpenses" label="Despesas restantes" defaultValue="0" /><Input name="remainingRevenue" label="Receita a reconhecer" required /><Textarea name="notes" label="Premissas" /><SubmitButton>Registrar</SubmitButton></ActionForm></Card>}
      </div>
    );
  }

  async function Financeiro() {
    const [pos, exps, meas] = await Promise.all([ctx.db.purchaseOrder.findMany({ where: { projectId: id } }), ctx.db.expense.findMany({ where: { projectId: id }, orderBy: { date: "desc" } }), p.contractId ? ctx.db.measurement.findMany({ where: { contractId: p.contractId }, orderBy: { competence: "desc" } }) : []]);
    const cats = await nameMap(ctx, "expenseCategory", exps.map((e) => e.categoryId));
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Compras e compromissos"><DataTable dense rows={pos} rowHref={(x) => `/app/suprimentos/pedidos/${x.id}`} columns={[{ key: "number", label: "Pedido" }, { key: "k", label: "Tipo", render: (x) => x.kind }, { key: "t", label: "Valor", align: "right", render: (x) => formatMoney(x.totalAmount) }, { key: "s", label: "Situação", render: (x) => <StatusBadge status={x.status} /> }]} empty={<p className="text-sm text-slate-500">Nenhum pedido de compra.</p>} /></Card>
        <Card title="Despesas"><DataTable dense rows={exps} rowHref={(x) => `/app/despesas/${x.id}`} columns={[{ key: "d", label: "Data", render: (x) => formatCivil(x.date) }, { key: "c", label: "Categoria", render: (x) => cats.get(x.categoryId) }, { key: "a", label: "Custo", align: "right", render: (x) => formatMoney(x.amount) }, { key: "b", label: "Cobrável", align: "right", render: (x) => formatMoney(x.billableAmount) }, { key: "s", label: "Situação", render: (x) => <StatusBadge status={x.status} /> }]} empty={<p className="text-sm text-slate-500">Nenhuma despesa.</p>} /></Card>
        <Card title="Medições e faturamento do contrato" className="lg:col-span-2"><DataTable dense rows={meas} rowHref={(x) => `/app/faturamento/medicoes/${x.id}`} columns={[{ key: "number", label: "Medição" }, { key: "c", label: "Competência", render: (x) => formatCivil(x.competence) }, { key: "t", label: "Total", align: "right", render: (x) => formatMoney(x.totalAmount) }, { key: "s", label: "Situação", render: (x) => <StatusBadge status={x.status} /> }]} empty={<p className="text-sm text-slate-500">Nenhuma medição.</p>} /></Card>
      </div>
    );
  }

  async function Encerramento() {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Encerramento operacional">
          {p.operationalClosedAt ? <Notice tone="success">Encerrado em {formatInstant(p.operationalClosedAt, ctx.timezone)}.</Notice> : canWrite && <ActionForm action={A.closeOperationalAction}><input type="hidden" name="id" value={id} /><p className="text-sm text-slate-600">Exige atividades concluídas e entregáveis aceitos — ou justificativa.</p><Input name="reason" label="Justificativa (se houver pendências)" /><SubmitButton variant="danger" confirm="Encerrar operacionalmente o projeto?">Encerrar operação</SubmitButton></ActionForm>}
        </Card>
        <Card title="Encerramento financeiro">
          {p.financialClosedAt ? <Notice tone="success">Encerrado em {formatInstant(p.financialClosedAt, ctx.timezone)}.</Notice> : canWrite && showMoney && <ActionForm action={A.closeFinancialAction}><input type="hidden" name="id" value={id} /><p className="text-sm text-slate-600">Exige operação encerrada, nada pendente de faturar e nenhuma conta a pagar/compra em aberto.</p><SubmitButton variant="danger" confirm="Encerrar financeiramente o projeto?">Encerrar financeiro</SubmitButton></ActionForm>}
        </Card>
      </div>
    );
  }
}

function Gantt({ tasks, today }: { tasks: { id: string; wbsCode: string; name: string; kind: string; status: string; plannedStart: Date | null; plannedEnd: Date | null; actualStart: Date | null; actualEnd: Date | null }[]; today: string }) {
  const dated = tasks.filter((t) => t.plannedStart && t.plannedEnd);
  if (!dated.length) return <Notice tone="info">Informe datas planejadas nas atividades para visualizar o cronograma.</Notice>;
  const min = Math.min(...dated.map((t) => t.plannedStart!.getTime()));
  const max = Math.max(...dated.map((t) => t.plannedEnd!.getTime()));
  const span = Math.max(1, max - min);
  const pos = (d: Date) => ((d.getTime() - min) / span) * 100;
  const todayPos = pos(civil(today));
  return (
    <div className="overflow-x-auto rounded-lg border bg-white p-3">
      <div className="relative min-w-[700px]">
        {todayPos >= 0 && todayPos <= 100 && <div className="absolute bottom-0 top-0 z-10 w-px bg-red-500" style={{ left: `calc(16rem + (100% - 16rem) * ${todayPos / 100})` }} title="Hoje" />}
        {dated.map((t) => (
          <div key={t.id} className="flex items-center gap-2 py-0.5 text-xs">
            <div className={cn("w-64 shrink-0 truncate", t.kind === "PHASE" && "font-semibold")}>{t.wbsCode} {t.name}</div>
            <div className="relative h-4 flex-1 rounded bg-slate-100">
              <div className={cn("absolute h-4 rounded", t.kind === "PHASE" ? "bg-slate-500" : t.kind === "MILESTONE" ? "bg-violet-500" : t.status === "DONE" ? "bg-emerald-500" : t.plannedEnd && toCivil(t.plannedEnd) < today ? "bg-red-400" : "bg-brand-500")}
                style={{ left: `${pos(t.plannedStart!)}%`, width: `${Math.max(1, pos(t.plannedEnd!) - pos(t.plannedStart!))}%` }} title={`${formatCivil(t.plannedStart)} – ${formatCivil(t.plannedEnd)}`} />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">Linha vermelha: hoje. Verde: concluída; vermelho: atrasada; roxo: marco.</p>
    </div>
  );
}
