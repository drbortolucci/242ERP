import Link from "next/link";
import { PageHeader, Card, StatusBadge, Tabs } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionButton, ActionForm, FormGrid, Input, Select, SubmitButton, Checkbox } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { capacityGrid, suggestProfessionals, weekStart } from "@/modules/resources/service";
import { lookups, nameMap } from "@/modules/config/lookups";
import { sp, type SearchParams } from "@/lib/query";
import { addDays, addMonths, formatCivil, monthEnd, monthStart, todayIn } from "@/lib/dates";
import { formatQty, formatPct } from "@/lib/money";
import { cn } from "@/lib/utils";
import { allocationAction, confirmAllocationAction, cancelAllocationAction } from "./actions";

export const metadata = { title: "Recursos e alocação" };
export default async function ResourcesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pagePerm(ctx, "resource.read");
  const view = sp(s, "visao") ?? "semanal";
  const today = todayIn(ctx.timezone);
  const from = view === "mensal" ? monthStart(today) : weekStart(today);
  const to = view === "mensal" ? monthEnd(addMonths(today, 2)) : addDays(weekStart(today), 7 * 6 - 1);
  const grid = await capacityGrid(ctx, null, from, to, view === "mensal" ? "month" : "week");
  const keys = grid.rows[0]?.buckets.map((b) => b.key) ?? [];
  const allocs = await ctx.db.allocation.findMany({ where: { status: { in: ["TENTATIVE", "CONFIRMED"] }, endDate: { gte: new Date(from) } }, orderBy: { startDate: "asc" }, take: 200 });
  const [pn, prn, profs, projects] = await Promise.all([nameMap(ctx, "professional", allocs.map((a) => a.professionalId)), nameMap(ctx, "project", allocs.map((a) => a.projectId)), lookups.professionals(ctx), ctx.db.project.findMany({ where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } } })]);
  const reqId = sp(s, "solicitacao");
  const req = reqId ? await ctx.db.resourceRequest.findFirst({ where: { id: reqId } }) : null;
  const suggestions = req ? await suggestProfessionals(ctx, req.id) : [];
  const openReqs = await ctx.db.resourceRequest.findMany({ where: { status: "OPEN" } });
  const reqProjects = await nameMap(ctx, "project", openReqs.map((r) => r.projectId));
  const canWrite = ctx.permissions.has("resource.write");
  const cell = (cap: { capacity: { isZero(): boolean; lt(x: unknown): boolean }; allocated: { gt(x: unknown): boolean; toString(): string } }) => cap.allocated.gt(cap.capacity as never) ? "bg-red-100 text-red-800" : cap.capacity.isZero() ? "bg-slate-50 text-slate-400" : "";
  return (
    <>
      <PageHeader title="Recursos e alocação" subtitle="Capacidade, alocação, horas apontadas e faturáveis — sempre em horas pelo calendário de cada profissional." breadcrumbs={[{ label: "Operação" }, { label: "Recursos" }]} />
      <Tabs active={view} tabs={[{ key: "semanal", label: "Visão semanal (6 semanas)", href: "/app/recursos?visao=semanal" }, { key: "mensal", label: "Visão mensal (3 meses)", href: "/app/recursos?visao=mensal" }]} />
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50"><tr><th className="px-2 py-2 text-left">Profissional</th>{keys.map((k) => <th key={k} className="px-2 py-2 text-center">{view === "mensal" ? k.slice(5, 7) + "/" + k.slice(0, 4) : formatCivil(k).slice(0, 5)}</th>)}<th className="px-2 text-right">Utilização faturável</th></tr></thead>
          <tbody>{grid.rows.map((r) => (
            <tr key={r.professional.id} className="border-t">
              <td className="px-2 py-1 font-medium"><Link className="text-brand-700 hover:underline" href={`/app/cadastros/profissionais/${r.professional.id}`}>{r.professional.name}</Link></td>
              {r.buckets.map((b) => <td key={b.key} className={cn("px-2 py-1 text-center tabular-nums", cell(b))} title={`Capacidade ${b.capacity}h · Alocado ${b.allocated}h · Apontado ${b.logged}h · Faturável ${b.billable}h`}>{formatQty(b.allocated, 0)}/{formatQty(b.capacity, 0)}<span className="block text-[10px] text-slate-500">apont. {formatQty(b.logged, 0)}</span></td>)}
              <td className="px-2 text-right">{formatPct(r.utilizationPct)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-slate-500">Célula: horas alocadas/capacidade (vermelho = sobrealocação). Utilização faturável = horas faturáveis apontadas ÷ capacidade.</p>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Alocações vigentes" className="xl:col-span-2">
          <DataTable dense rows={allocs} columns={[{ key: "p", label: "Profissional", render: (a) => pn.get(a.professionalId) }, { key: "pr", label: "Projeto", render: (a) => a.projectId ? <Link className="text-brand-700 underline" href={`/app/projetos/${a.projectId}`}>{prn.get(a.projectId)}</Link> : "—" }, { key: "per", label: "Período", render: (a) => `${formatCivil(a.startDate)} – ${formatCivil(a.endDate)}` }, { key: "v", label: "Alocação", render: (a) => `${a.mode === "PERCENT" ? `${a.value}%` : a.mode === "HOURS_PER_DAY" ? `${a.value}h/dia` : `${a.value}h`}` }, { key: "t", label: "Horas", align: "right", render: (a) => formatQty(a.totalHours) }, { key: "s", label: "Situação", render: (a) => <StatusBadge status={a.status} /> }, { key: "o", label: "Exceção", render: (a) => a.overrideReason ?? "—" },
            { key: "x", label: "", render: (a) => canWrite && <div className="flex flex-col gap-1">{a.status === "TENTATIVE" && <ActionForm action={confirmAllocationAction} className="space-y-1"><input type="hidden" name="id" value={a.id} /><input name="overrideReason" placeholder="Justificativa (se conflito)" aria-label="Justificativa" className="w-40 rounded border px-1 text-xs" /><SubmitButton variant="secondary">Confirmar</SubmitButton></ActionForm>}<ActionButton action={cancelAllocationAction} fields={{ id: a.id }} variant="danger" confirm="Cancelar alocação?">Cancelar</ActionButton></div> }]} />
        </Card>
        {canWrite && (
          <Card title={req ? "Atender solicitação" : "Nova alocação"}>
            {req && <div className="mb-3 text-sm"><p>Solicitação: {formatQty(req.hours)}h de {formatCivil(req.startDate)} a {formatCivil(req.endDate)}.</p><p className="mt-1 font-medium">Sugestões por disponibilidade:</p><ul className="text-xs">{suggestions.slice(0, 6).map((x) => <li key={x.professional.id}>{x.professional.name} — livre {formatQty(x.free)}h (cap. {formatQty(x.capacity)}h)</li>)}</ul></div>}
            <ActionForm action={allocationAction}>
              {req && <input type="hidden" name="requestId" value={req.id} />}
              <Select name="professionalId" label="Profissional" options={profs} required defaultValue={suggestions[0]?.professional.id} />
              <Select name="projectId" label="Projeto" options={projects.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` }))} required defaultValue={req?.projectId ?? sp(s, "projeto")} />
              <FormGrid cols={2}><Input name="startDate" type="date" label="De" required defaultValue={req ? req.startDate.toISOString().slice(0, 10) : ""} /><Input name="endDate" type="date" label="Até" required defaultValue={req ? req.endDate.toISOString().slice(0, 10) : ""} /></FormGrid>
              <FormGrid cols={2}><Select name="mode" label="Forma" options={[{ value: "PERCENT", label: "% da capacidade" }, { value: "HOURS_PER_DAY", label: "Horas por dia" }, { value: "TOTAL_HOURS", label: "Total de horas" }]} /><Input name="value" label="Valor" required defaultValue={req ? req.hours.toString() : ""} /></FormGrid>
              <Select name="status" label="Tipo" options={[{ value: "TENTATIVE", label: "Reserva provisória" }, { value: "CONFIRMED", label: "Confirmada" }]} />
              <Input name="overrideReason" label="Justificativa (exigida se confirmar com conflito)" />
              <Checkbox name="billable" label="Faturável" defaultChecked />
              <div className="flex gap-2"><SubmitButton name="mode_action" value="preview" variant="secondary">Simular conflitos</SubmitButton><SubmitButton name="mode_action" value="save">Registrar</SubmitButton></div>
            </ActionForm>
          </Card>
        )}
      </div>
      {openReqs.length > 0 && <Card title="Solicitações de recursos em aberto (previsão de demanda)" className="mt-6"><ul className="text-sm">{openReqs.map((r) => <li key={r.id}><Link className="text-brand-700 underline" href={`/app/recursos?solicitacao=${r.id}`}>{reqProjects.get(r.projectId)}</Link> — {formatQty(r.hours)}h de {formatCivil(r.startDate)} a {formatCivil(r.endDate)}</li>)}</ul></Card>}
    </>
  );
}
