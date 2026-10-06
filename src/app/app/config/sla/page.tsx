import { PageHeader, Card } from "@/components/ui/page";
import { ActionForm, Checkbox, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import { pagePerm } from "@/server/page-guard";
import { requireCtx } from "@/server/auth/next";
import { lookups } from "@/modules/config/lookups";
import { saveSlaAction } from "../special-actions";

const PAUSE = [{ value: "WAITING_CUSTOMER", label: "Aguardando cliente" }, { value: "WAITING_THIRD_PARTY", label: "Aguardando terceiro" }];
export default async function SlaPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "settings.manage");
  const [pols, targets, cals] = await Promise.all([ctx.db.slaPolicy.findMany(), ctx.db.slaTarget.findMany(), lookups.calendars(ctx)]);
  const form = (p?: (typeof pols)[number]) => {
    const t = (pr: string) => targets.find((x) => x.policyId === p?.id && x.priority === pr);
    return (
      <ActionForm action={saveSlaAction}>
        {p && <input type="hidden" name="id" value={p.id} />}
        <FormGrid cols={4}><Input name="name" label="Nome" defaultValue={p?.name ?? ""} required /><Select name="calendarId" label="Calendário de atendimento" options={cals} placeholder="24x7" defaultValue={p?.calendarId ?? ""} /><Input name="reopenWindowDays" type="number" label="Reabertura até (dias após solução)" defaultValue={String(p?.reopenWindowDays ?? 7)} /><Input name="autoCloseDays" type="number" label="Encerramento automático (dias após solução)" defaultValue={String(p?.autoCloseDays ?? 5)} /></FormGrid>
        <fieldset className="flex gap-4"><legend className="text-xs font-medium">Estados que pausam o SLA</legend>{PAUSE.map((s) => <Checkbox key={s.value} name="pauseStatuses[]" value={s.value} label={s.label} defaultChecked={p ? p.pauseStatuses.includes(s.value) : true} />)}</fieldset>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {["P1", "P2", "P3", "P4"].map((pr, i) => <div key={pr} className="rounded border p-2"><b className="text-sm">{pr}</b><Input name={`p${i + 1}r`} type="number" label="Resposta (min úteis)" defaultValue={String(t(pr)?.responseMinutes ?? [30, 60, 240, 480][i])} /><Input name={`p${i + 1}s`} type="number" label="Solução (min úteis)" defaultValue={String(t(pr)?.resolutionMinutes ?? [240, 480, 1440, 2880][i])} /></div>)}
        </div>
        <Input name="escalatePct" type="number" label="Escalar ao consumir (% do prazo)" defaultValue={String(t("P1")?.escalateAfterPct ?? 80)} />
        <p className="text-xs text-slate-500">Prioridade = matriz impacto × urgência (1 alto … 3 baixo): soma 2 → P1, 3 → P2, 4 → P3, 5–6 → P4.</p>
        <SubmitButton>{p ? "Salvar" : "Criar política"}</SubmitButton>
      </ActionForm>
    );
  };
  return (
    <>
      <PageHeader title="Regras de SLA" breadcrumbs={[{ label: "Configurador", href: "/app/config" }, { label: "SLA" }]} />
      <div className="space-y-6">{pols.map((p) => <Card key={p.id} title={p.name}>{form(p)}</Card>)}<Card title="Nova política">{form()}</Card></div>
    </>
  );
}
