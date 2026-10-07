import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card, DefinitionList, StatusBadge, Badge, Notice } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionForm, FormGrid, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { lookups, nameMap, userNameMap } from "@/modules/config/lookups";
import { getTicket, listComments, slaView } from "@/modules/ams/tickets";
import { searchArticles } from "@/modules/ams/knowledge";
import { formatInstant, todayIn } from "@/lib/dates";
import { formatQty, sum } from "@/lib/money";
import { statusLabel } from "@/lib/labels";
import { ticketStatusAction, ticketCommentAction, ticketAssignAction, ticketPriorityAction, ticketProblemAction, ticketRateAction, ticketTimeAction } from "../../actions";
import { LEVEL_OPTIONS, PRIORITY_TONE, typeLabel } from "../../constants";

const NEXT: Record<string, { to: string; label: string; note?: boolean; variant?: "primary" | "secondary" | "danger" }[]> = {
  NEW: [{ to: "IN_PROGRESS", label: "Iniciar atendimento", variant: "primary" }, { to: "WAITING_CUSTOMER", label: "Aguardar cliente", note: true }, { to: "RESOLVED", label: "Resolver", note: true }, { to: "CANCELED", label: "Cancelar", note: true, variant: "danger" }],
  IN_PROGRESS: [{ to: "WAITING_CUSTOMER", label: "Aguardar cliente", note: true }, { to: "WAITING_THIRD_PARTY", label: "Aguardar terceiro", note: true }, { to: "RESOLVED", label: "Resolver", note: true, variant: "primary" }, { to: "CANCELED", label: "Cancelar", note: true, variant: "danger" }],
  WAITING_CUSTOMER: [{ to: "IN_PROGRESS", label: "Retomar", variant: "primary" }, { to: "RESOLVED", label: "Resolver", note: true }],
  WAITING_THIRD_PARTY: [{ to: "IN_PROGRESS", label: "Retomar", variant: "primary" }, { to: "RESOLVED", label: "Resolver", note: true }],
  RESOLVED: [{ to: "CLOSED", label: "Encerrar (cliente confirmou)" }, { to: "IN_PROGRESS", label: "Reabrir", note: true }],
  CLOSED: [{ to: "IN_PROGRESS", label: "Reabrir", note: true }],
};
const EVENT: Record<string, string> = { STATUS: "Situação", ASSIGN: "Atribuição", ESCALATION: "Escalonamento", PRIORITY: "Prioridade", REOPEN: "Reabertura", SLA_BREACH: "Violação de SLA" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  pagePerm(ctx, "ams.read");
  const t = await getTicket(ctx, id).catch(() => null);
  if (!t) notFound();
  const [comments, events, entries, professionals, problems, incidents, sla, articles] = await Promise.all([
    listComments(ctx, id), ctx.db.ticketEvent.findMany({ where: { ticketId: id }, orderBy: { createdAt: "asc" } }), ctx.db.timeEntry.findMany({ where: { ticketId: id }, orderBy: { date: "desc" } }),
    lookups.professionals(ctx), ctx.db.ticket.findMany({ where: { type: "PROBLEM", id: { not: id }, status: { notIn: ["CLOSED", "CANCELED"] } }, select: { id: true, number: true, title: true } }),
    t.type === "PROBLEM" ? ctx.db.ticket.findMany({ where: { problemTicketId: id } }) : [], slaView(ctx, t), searchArticles(ctx, `${t.title} ${t.module ?? ""}`, { system: t.system, take: 5 }),
  ]);
  const [pn, ct, prof, users, profAll] = await Promise.all([
    nameMap(ctx, "party", [t.partyId]), nameMap(ctx, "contract", [t.contractId]), nameMap(ctx, "professional", [t.assigneeProfessionalId]),
    userNameMap([t.openedByUserId, ...events.map((e) => e.byUserId)]), nameMap(ctx, "professional", entries.map((e) => e.professionalId)),
  ]);
  const problem = t.problemTicketId ? await ctx.db.ticket.findFirst({ where: { id: t.problemTicketId }, select: { id: true, number: true, title: true } }) : null;
  const can = ctx.permissions.has("ams.write");
  const tz = ctx.timezone;
  return (
    <>
      <PageHeader title={`${t.number} — ${t.title}`} subtitle={<span className="flex flex-wrap gap-2"><StatusBadge status={t.status} /><Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge><Badge>{typeLabel(t.type)}</Badge>{t.reopenCount > 0 && <Badge tone="amber">reaberto {t.reopenCount}×</Badge>}</span>}
        breadcrumbs={[{ label: "Chamados", href: "/app/ams/chamados" }, { label: t.number }]} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {can && (NEXT[t.status] ?? []).length > 0 && (
            <Card title="Ações">
              <div className="grid gap-3 md:grid-cols-2">
                {(NEXT[t.status] ?? []).map((a) => (
                  <ActionForm key={a.to} action={ticketStatusAction} className="rounded border border-slate-200 p-2">
                    <input type="hidden" name="id" value={id} /><input type="hidden" name="to" value={a.to} />
                    {a.note && <Input name="note" label={a.to === "CANCELED" ? "Motivo" : "Nota interna (opcional)"} required={a.to === "CANCELED"} />}
                    <SubmitButton variant={a.variant ?? "secondary"}>{a.label}</SubmitButton>
                  </ActionForm>
                ))}
              </div>
            </Card>
          )}
          <Card title="Descrição"><p className="whitespace-pre-wrap text-sm">{t.description}</p></Card>
          <Card title="Conversa">
            <ul className="space-y-3">
              {comments.map((c) => (
                <li key={c.id} className={`rounded border p-3 text-sm ${c.visibility === "INTERNAL" ? "border-amber-200 bg-amber-50" : "border-slate-200"}`}>
                  <div className="mb-1 flex justify-between text-xs text-slate-500"><span>{c.authorName}{c.visibility === "INTERNAL" && <> · <b>interno</b></>}</span><span>{formatInstant(c.createdAt, tz)}</span></div>
                  <p className="whitespace-pre-wrap">{c.body}</p>
                </li>
              ))}
              {comments.length === 0 && <li className="text-sm text-slate-500">Sem mensagens.</li>}
            </ul>
            {can && !["CLOSED", "CANCELED"].includes(t.status) && (
              <ActionForm action={ticketCommentAction} resetOnSuccess className="mt-4 border-t pt-4">
                <input type="hidden" name="id" value={id} />
                <Textarea name="body" label="Mensagem" required />
                <Select name="visibility" label="Visibilidade" options={[{ value: "PUBLIC", label: "Pública (cliente vê no portal)" }, { value: "INTERNAL", label: "Interna (somente equipe)" }]} />
                <SubmitButton variant="secondary">Enviar</SubmitButton>
              </ActionForm>
            )}
          </Card>
          <Card title={`Horas no chamado (${formatQty(sum(entries.map((e) => e.hours)))} h)`}>
            <DataTable dense rows={entries} empty="Nenhum apontamento." columns={[{ key: "d", label: "Data", render: (e) => e.date.toISOString().slice(0, 10).split("-").reverse().join("/") }, { key: "p", label: "Profissional", render: (e) => profAll.get(e.professionalId) }, { key: "h", label: "Horas", align: "right", render: (e) => formatQty(e.hours) }, { key: "desc", label: "Descrição", render: (e) => e.description }, { key: "s", label: "Situação", render: (e) => <StatusBadge status={e.status} /> }]} />
            {ctx.professionalId && ctx.permissions.has("time.write") && !["CLOSED", "CANCELED"].includes(t.status) && (
              <ActionForm action={ticketTimeAction} resetOnSuccess className="mt-3 border-t pt-3">
                <input type="hidden" name="id" value={id} />
                <FormGrid cols={3}><Input name="date" type="date" label="Data" defaultValue={todayIn(tz)} /><Input name="hours" label="Horas" required /><Input name="description" label="Atividade" required /></FormGrid>
                <SubmitButton variant="secondary">Apontar horas</SubmitButton>
                <p className="text-xs text-slate-500">Horas aprovadas consomem a franquia/banco de horas do contrato (FIFO).</p>
              </ActionForm>
            )}
          </Card>
          {t.type === "PROBLEM" && (
            <Card title="Incidentes vinculados a este problema">
              <DataTable dense rows={incidents} empty="Nenhum incidente vinculado." columns={[{ key: "n", label: "Número", render: (r) => <Link className="text-brand-700 underline" href={`/app/ams/chamados/${r.id}`}>{r.number}</Link> }, { key: "title", label: "Título" }, { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> }]} />
            </Card>
          )}
          <Card title="Histórico">
            <ul className="space-y-1 text-sm">
              {events.map((e) => <li key={e.id}><span className="text-slate-500">{formatInstant(e.createdAt, tz)}</span> — {EVENT[e.kind] ?? e.kind}: {e.fromValue ? `${statusLabel(e.fromValue)} → ` : ""}{e.toValue ? statusLabel(e.toValue) : ""} <span className="text-xs text-slate-500">({e.byUserId ? users.get(e.byUserId) : "sistema"})</span></li>)}
            </ul>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="SLA">
            {sla ? (
              <>
                <DefinitionList items={[
                  { label: "Política", value: sla.policyName },
                  { label: "Resposta até", value: <>{formatInstant(t.responseDueAt, tz)} {t.responseBreached ? <Badge tone="red">violado</Badge> : t.firstResponseAt ? <Badge tone="green">respondido</Badge> : null}</> },
                  { label: "Primeira resposta", value: formatInstant(t.firstResponseAt, tz) },
                  { label: "Solução até", value: <>{formatInstant(t.resolutionDueAt, tz)} {t.resolutionBreached && <Badge tone="red">violado</Badge>}</> },
                  { label: "Prazo consumido", value: `${sla.consumedPct}%` },
                  { label: "Minutos úteis pausados", value: sla.pausedMinutes },
                  { label: "Escalonamento", value: t.escalationLevel === 0 ? "—" : t.escalationLevel === 1 ? "Nível 1 (em risco)" : "Nível 2 (violado)" },
                ]} />
                <div className="mt-2 h-2 rounded bg-slate-100"><div className={`h-2 rounded ${sla.consumedPct >= 100 ? "bg-red-500" : sla.atRisk ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, sla.consumedPct)}%` }} /></div>
                {sla.paused && <div className="mt-2"><Notice tone="info">SLA pausado enquanto aguarda cliente/terceiro.</Notice></div>}
              </>
            ) : <p className="text-sm text-slate-500">Sem política de SLA aplicável.</p>}
          </Card>
          <Card title="Detalhes">
            <DefinitionList items={[
              { label: "Cliente", value: <Link className="text-brand-700 underline" href={`/app/cadastros/clientes/${t.partyId}`}>{pn.get(t.partyId)}</Link> },
              { label: "Contrato", value: t.contractId ? <Link className="text-brand-700 underline" href={`/app/ams/saldos/${t.contractId}`}>{ct.get(t.contractId)}</Link> : "—" },
              { label: "Sistema / módulo", value: [t.system, t.module].filter(Boolean).join(" / ") || "—" }, { label: "Categoria", value: t.category ?? "—" },
              { label: "Impacto × urgência", value: `${t.impact} × ${t.urgency}` }, { label: "Solicitante", value: t.openedByContactName ?? (t.openedByUserId ? users.get(t.openedByUserId) : "—") },
              { label: "Aberto em", value: formatInstant(t.openedAt, tz) }, { label: "Resolvido em", value: formatInstant(t.resolvedAt, tz) }, { label: "Encerrado em", value: formatInstant(t.closedAt, tz) },
              { label: "Responsável", value: prof.get(t.assigneeProfessionalId ?? "") ?? "não atribuído" }, { label: "Equipe", value: t.team ?? "—" },
              { label: "Problema relacionado", value: problem ? <Link className="text-brand-700 underline" href={`/app/ams/chamados/${problem.id}`}>{problem.number}</Link> : "—" },
              { label: "Satisfação", value: t.csatScore ? `${t.csatScore}/5${t.csatComment ? ` — ${t.csatComment}` : ""}` : "—" },
            ]} />
          </Card>
          {can && !["CLOSED", "CANCELED"].includes(t.status) && (
            <>
              <Card title="Atribuir">
                <ActionForm action={ticketAssignAction}><input type="hidden" name="id" value={id} /><Select name="professionalId" label="Responsável" options={professionals} placeholder="—" defaultValue={t.assigneeProfessionalId ?? ""} /><Input name="team" label="Equipe" defaultValue={t.team ?? ""} /><SubmitButton variant="secondary">Atribuir</SubmitButton></ActionForm>
              </Card>
              <Card title="Reclassificar prioridade">
                <ActionForm action={ticketPriorityAction}><input type="hidden" name="id" value={id} /><FormGrid cols={2}><Select name="impact" label="Impacto" options={LEVEL_OPTIONS} defaultValue={String(t.impact)} /><Select name="urgency" label="Urgência" options={LEVEL_OPTIONS} defaultValue={String(t.urgency)} /></FormGrid><Input name="reason" label="Justificativa" required /><SubmitButton variant="secondary">Recalcular</SubmitButton></ActionForm>
              </Card>
              {t.type !== "PROBLEM" && (
                <Card title="Vincular a problema">
                  <ActionForm action={ticketProblemAction}><input type="hidden" name="id" value={id} /><Select name="problemId" label="Problema" options={problems.map((p) => ({ value: p.id, label: `${p.number} ${p.title}` }))} placeholder="—" defaultValue={t.problemTicketId ?? ""} /><SubmitButton variant="secondary">Salvar</SubmitButton></ActionForm>
                </Card>
              )}
            </>
          )}
          {can && ["RESOLVED", "CLOSED"].includes(t.status) && !t.csatScore && (
            <Card title="Registrar satisfação do cliente">
              <ActionForm action={ticketRateAction}><input type="hidden" name="id" value={id} /><Select name="score" label="Nota" options={["5", "4", "3", "2", "1"].map((v) => ({ value: v, label: v }))} /><Input name="comment" label="Comentário" /><SubmitButton variant="secondary">Registrar</SubmitButton></ActionForm>
            </Card>
          )}
          <Card title="Artigos sugeridos">
            {articles.length === 0 ? <p className="text-sm text-slate-500">Nenhum artigo relacionado.</p> : <ul className="list-disc pl-5 text-sm">{articles.map((a) => <li key={a.id}><Link className="text-brand-700 underline" href={`/app/ams/conhecimento/${a.id}`}>{a.title}</Link></li>)}</ul>}
          </Card>
        </div>
      </div>
    </>
  );
}
