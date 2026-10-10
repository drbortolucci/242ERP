import Link from "@/components/ui/access-link";
import { PageHeader, Card, StatusBadge, Notice, Badge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionButton, ActionForm, Checkbox, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pageAnyPerm } from "@/server/page-guard";
import { billingBlockReason } from "@/modules/timesheet/service";
import { weekStart } from "@/modules/resources/service";
import { lookups, nameMap } from "@/modules/config/lookups";
import { addDays, civil, formatCivil, todayIn } from "@/lib/dates";
import { formatQty, sum } from "@/lib/money";
import { statusLabel } from "@/lib/labels";
import { createEntryAction, submitEntriesAction, deleteEntryAction } from "./actions";

export const metadata = { title: "Horas" };
export default async function TimesheetPage({ searchParams }: { searchParams: Promise<{ semana?: string; profissional?: string; projeto?: string }> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pageAnyPerm(ctx, "time.write", "time.approve");
  const today = todayIn(ctx.timezone);
  const ws = s.semana ?? weekStart(today);
  const we = addDays(ws, 6);
  const canAny = ctx.permissions.has("time.write_any");
  const profId = (canAny && s.profissional) || ctx.professionalId;
  const where = s.projeto && ctx.permissions.has("project.read") ? { projectId: s.projeto } : { professionalId: profId ?? "__none__", date: { gte: civil(ws), lte: civil(we) } };
  const entries = await ctx.db.timeEntry.findMany({ where, orderBy: [{ date: "asc" }, { createdAt: "asc" }], take: 500 });
  const [projects, tickets, contracts, profs] = await Promise.all([
    ctx.db.project.findMany({ where: { status: { in: ["PLANNING", "ACTIVE"] } }, orderBy: { code: "asc" } }),
    ctx.db.ticket.findMany({ where: { status: { notIn: ["CLOSED", "CANCELED"] } }, orderBy: { createdAt: "desc" }, take: 200 }),
    ctx.db.contract.findMany({ where: { status: "ACTIVE" } }),
    canAny ? lookups.professionals(ctx) : Promise.resolve([]),
  ]);
  const tasks = await ctx.db.projectTask.findMany({ where: { projectId: { in: projects.map((p) => p.id) }, kind: { not: "PHASE" }, status: { not: "DONE" } } });
  const pmap = await nameMap(ctx, "project", entries.map((e) => e.projectId));
  const total = sum(entries.map((e) => e.hours));
  const drafts = entries.filter((e) => e.status === "DRAFT" || e.status === "REJECTED");
  return (
    <>
      <PageHeader title={s.projeto ? `Horas do projeto ${pmap.get(s.projeto) ?? ""}` : "Meus apontamentos"} subtitle={s.projeto ? undefined : `Semana de ${formatCivil(ws)} a ${formatCivil(we)} · total ${formatQty(total)}h`} breadcrumbs={[{ label: "Operação" }, { label: "Horas" }]}
        actions={<>{!s.projeto && <><Link className="rounded border bg-white px-2 py-1 text-sm" href={`/app/horas?semana=${addDays(ws, -7)}${s.profissional ? `&profissional=${s.profissional}` : ""}`}>← Semana anterior</Link><Link className="rounded border bg-white px-2 py-1 text-sm" href={`/app/horas?semana=${addDays(ws, 7)}${s.profissional ? `&profissional=${s.profissional}` : ""}`}>Próxima →</Link></>}{ctx.permissions.has("time.approve") && <Link className="rounded bg-brand-600 px-3 py-1.5 text-sm text-white" href="/app/horas/aprovacao">Aprovação</Link>}</>} />
      {!profId && <div className="mb-4"><Notice tone="warn">Seu usuário não está vinculado a um profissional. Peça ao administrador (Usuários › editar › Profissional vinculado).</Notice></div>}
      {canAny && <form className="mb-4 flex gap-2 text-sm" method="get"><input type="hidden" name="semana" value={ws} /><label htmlFor="pf" className="sr-only">Profissional</label><select id="pf" name="profissional" defaultValue={profId ?? ""} className="rounded border px-2 py-1">{profs.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select><button className="rounded border bg-white px-2">Ver</button></form>}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <DataTable rows={entries} columns={[
              { key: "sel", label: "", render: (e) => (e.status === "DRAFT" || e.status === "REJECTED") && <input type="checkbox" form="submit-entries" name="ids[]" value={e.id} defaultChecked aria-label="Selecionar" /> },
              { key: "date", label: "Data", render: (e) => formatCivil(e.date) },
              { key: "ctx", label: "Contexto", render: (e) => e.projectId ? pmap.get(e.projectId) : e.ticketId ? `Chamado` : e.internalCode ? `Interno: ${e.internalCode}` : "Contrato" },
              { key: "description", label: "Descrição", render: (e) => <span>{e.description}{e.adjustsEntryId && <Badge tone="violet">ajuste</Badge>}{e.rejectionReason && <span className="block text-xs text-red-700">Rejeitado: {e.rejectionReason}</span>}</span> },
              { key: "hours", label: "Horas", align: "right", render: (e) => <span>{formatQty(e.hours)}{e.overtime && <Badge tone="amber">extra</Badge>}</span> },
              { key: "billable", label: "Fat.", render: (e) => (e.billable ? "Sim" : "Não") },
              { key: "status", label: "Situação", render: (e) => <StatusBadge status={e.status} /> },
              { key: "billing", label: "Faturamento", render: (e) => { const r = billingBlockReason(e); return <span title={r ? `${r.reason} → ${r.action}` : ""}><StatusBadge status={e.billingStatus} />{r && e.status === "APPROVED" && <span className="block text-[11px] text-slate-500">{r.reason}</span>}</span>; } },
              { key: "x", label: "", render: (e) => e.status === "DRAFT" && <ActionButton action={deleteEntryAction} fields={{ id: e.id }} variant="danger">Excluir</ActionButton> },
            ]} empty={<p className="text-sm text-slate-500">Nenhum apontamento no período.</p>} />
          {drafts.length > 0 && <ActionForm action={submitEntriesAction} id="submit-entries" className="mt-3"><SubmitButton>Enviar selecionados para aprovação</SubmitButton></ActionForm>}
        </div>
        {profId && (
          <Card title="Novo apontamento">
            <ActionForm action={createEntryAction} resetOnSuccess>
              {canAny && <input type="hidden" name="professionalId" value={profId} />}
              <FormGrid cols={2}><Input name="date" type="date" label="Data" required defaultValue={today} /><Input name="hours" label="Horas" required placeholder="ex.: 7,5" /></FormGrid>
              <Select name="projectId" label="Projeto" options={projects.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` }))} placeholder="—" />
              <Select name="taskId" label="Atividade/pacote" options={tasks.map((t) => ({ value: t.id, label: `${projects.find((p) => p.id === t.projectId)?.code} · ${t.wbsCode} ${t.name}` }))} placeholder="—" />
              <Select name="ticketId" label="ou Chamado AMS" options={tickets.map((t) => ({ value: t.id, label: `${t.number} ${t.title}` }))} placeholder="—" />
              <Select name="contractId" label="ou Contrato (sem projeto)" options={contracts.map((c) => ({ value: c.id, label: `${c.number} ${c.title}` }))} placeholder="—" />
              <Select name="internalCode" label="ou Atividade interna" options={["Pré-venda", "Treinamento interno", "Administrativo", "Gestão de pessoas"].map((v) => ({ value: v, label: v }))} placeholder="—" />
              <Select name="activityType" label="Tipo de atividade" options={["WORK", "MEETING", "TRAVEL", "TRAINING", "SUPPORT", "INTERNAL"].map((v) => ({ value: v, label: ({ WORK: "Execução", MEETING: "Reunião", TRAVEL: "Deslocamento", TRAINING: "Treinamento", SUPPORT: "Suporte", INTERNAL: "Interna" } as Record<string, string>)[v] }))} />
              <Input name="description" label="Descrição" required />
              <Checkbox name="billable" label="Faturável (quando houver contrato)" defaultChecked />
              <SubmitButton>Registrar</SubmitButton>
            </ActionForm>
            <p className="mt-2 text-xs text-slate-500">Informe exatamente um contexto. Frações de 15 min. Limites diários e períodos fechados são validados. Status: {["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"].map(statusLabel).join(" → ")}.</p>
          </Card>
        )}
      </div>
    </>
  );
}
