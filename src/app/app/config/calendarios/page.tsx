import { PageHeader, Card } from "@/components/ui/page";
import { ActionButton, ActionForm, FormGrid, Input, SubmitButton } from "@/components/ui/form";
import { pagePerm } from "@/server/page-guard";
import { requireCtx } from "@/server/auth/next";
import { formatCivil } from "@/lib/dates";
import { saveCalendarAction, addHolidayAction, removeHolidayAction } from "../special-actions";

const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default async function CalendarsPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "settings.manage");
  const cals = await ctx.db.workCalendar.findMany({ orderBy: { createdAt: "asc" } });
  const holidays = await ctx.db.holiday.findMany({ orderBy: { date: "asc" } });
  const form = (c?: (typeof cals)[number]) => (
    <ActionForm action={saveCalendarAction}>
      {c && <input type="hidden" name="id" value={c.id} />}
      <FormGrid cols={3}><Input name="name" label="Nome" defaultValue={c?.name ?? ""} required /><Input name="businessStart" label="Início do atendimento (SLA)" type="time" defaultValue={hhmm(c?.businessStartMinute ?? 540)} /><Input name="businessEnd" label="Fim do atendimento (SLA)" type="time" defaultValue={hhmm(c?.businessEndMinute ?? 1080)} /></FormGrid>
      <input type="hidden" name="timezone" value={c?.timezone ?? "America/Sao_Paulo"} />
      <div className="grid grid-cols-4 gap-2 md:grid-cols-7">{WEEK.map((d, i) => <Input key={d} name={`h${i}`} label={`${d} (h)`} defaultValue={String(c?.weeklyHours[i] ?? (i === 0 || i === 6 ? 0 : 8))} />)}</div>
      <SubmitButton>{c ? "Salvar" : "Criar calendário"}</SubmitButton>
    </ActionForm>
  );
  return (
    <>
      <PageHeader title="Calendários, feriados e capacidade" subtitle="Capacidade dos profissionais = horas do calendário × % de capacidade, descontando feriados e ausências. A janela de atendimento é usada no cálculo de SLA." breadcrumbs={[{ label: "Configurador", href: "/app/config" }, { label: "Calendários" }]} />
      <div className="space-y-6">
        {cals.map((c) => (
          <Card key={c.id} title={c.name}>
            {form(c)}
            <h3 className="mb-2 mt-4 text-sm font-semibold">Feriados</h3>
            <ul className="mb-3 grid gap-1 text-sm md:grid-cols-3">{holidays.filter((h) => h.calendarId === c.id).map((h) => <li key={h.id} className="flex items-center gap-2">{formatCivil(h.date)} — {h.name} <ActionButton action={removeHolidayAction} fields={{ id: h.id }} variant="secondary">remover</ActionButton></li>)}</ul>
            <ActionForm action={addHolidayAction} resetOnSuccess><input type="hidden" name="calendarId" value={c.id} /><FormGrid cols={3}><Input name="date" type="date" label="Data" required /><Input name="name" label="Feriado" required /></FormGrid><SubmitButton variant="secondary">Incluir feriado</SubmitButton></ActionForm>
          </Card>
        ))}
        <Card title="Novo calendário">{form()}</Card>
      </div>
    </>
  );
}
