import { PageHeader, Card } from "@/components/ui/page";
import { ActionForm, Checkbox, FormGrid, Input, SubmitButton, Textarea } from "@/components/ui/form";
import { pagePerm } from "@/server/page-guard";
import { requireCtx } from "@/server/auth/next";
import { getSetting } from "@/server/settings";
import { savePoliciesAction } from "../special-actions";

const MODULES = [["crm", "CRM e propostas"], ["projects", "Projetos"], ["resources", "Recursos"], ["timesheet", "Horas"], ["expenses", "Despesas"], ["procurement", "Suprimentos"], ["ams", "Atendimento recorrente (AMS)"], ["billing", "Faturamento"], ["finance", "Financeiro"], ["controlling", "Controladoria"], ["portal", "Portais"]];
export default async function PoliciesPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "settings.manage");
  const [sod, ts, al, bl, mods, cl, rr] = await Promise.all([getSetting(ctx, "sod"), getSetting(ctx, "timesheet"), getSetting(ctx, "allocation"), getSetting(ctx, "billing"), getSetting(ctx, "modules"), getSetting(ctx, "closing"), getSetting(ctx, "revenueRecognition")]);
  return (
    <>
      <PageHeader title="Políticas e módulos" breadcrumbs={[{ label: "Configurador", href: "/app/config" }, { label: "Políticas" }]} />
      <ActionForm action={savePoliciesAction} className="space-y-6">
        <Card title="Segregação de funções">
          <Checkbox name="requesterCannotApprove" label="Quem solicita não pode aprovar (propostas, compras, despesas, horas próprias)" defaultChecked={sod.requesterCannotApprove} />
          <Checkbox name="approverCannotPay" label="Quem aprova uma conta a pagar não pode registrar o pagamento" defaultChecked={sod.approverCannotPay} />
          <Checkbox name="measurementCreatorCannotApprove" label="Quem gera a medição não pode aprová-la" defaultChecked={sod.measurementCreatorCannotApprove} />
        </Card>
        <Card title="Apontamento de horas e alocação">
          <FormGrid cols={4}>
            <Input name="maxHoursPerDay" type="number" step="0.5" label="Máximo de horas/dia" defaultValue={String(ts.maxHoursPerDay)} />
            <Input name="overtimeAfterHoursPerDay" type="number" step="0.5" label="Hora extra acima de (h/dia)" defaultValue={String(ts.overtimeAfterHoursPerDay)} />
            <Input name="allowFutureDays" type="number" label="Dias futuros permitidos" defaultValue={String(ts.allowFutureDays)} />
            <Input name="lockAfterDays" type="number" label="Bloquear apontamentos com mais de (dias)" defaultValue={String(ts.lockAfterDays)} />
            <Input name="overallocationTolerancePct" type="number" label="Tolerância de sobrealocação (%)" defaultValue={String(al.overallocationTolerancePct)} />
            <Input name="defaultDueDays" type="number" label="Vencimento padrão (dias)" defaultValue={String(bl.defaultDueDays)} />
          </FormGrid>
        </Card>
        <Card title="Módulos habilitados (dentro do plano contratado)">
          <div className="grid gap-1 md:grid-cols-4">{MODULES.map(([k, l]) => <Checkbox key={k} name="modules[]" value={k} label={l} defaultChecked={mods.enabled.includes(k)} />)}</div>
        </Card>
        <Card title="Fechamento e reabertura de períodos">
          <Checkbox name="requireReasonToReopen" label="Exigir justificativa para reabrir período" defaultChecked={cl.requireReasonToReopen} />
        </Card>
        <Card title="Reconhecimento de receita gerencial">
          <p className="mb-2 text-sm text-slate-600">Métodos por contrato: T&M (horas aprovadas × tarifa), % de conclusão por horas (preço fechado), marcos aceitos, linear mensal (recorrente/AMS) ou na aprovação da medição. Recebimento nunca é usado como reconhecimento. Ver docs/FORMULAS.md.</p>
          <p className="mb-2 text-sm">Aprovação registrada: <b>{rr.approvedBy ? `${rr.approvedBy} em ${rr.approvedAt?.slice(0, 10)}` : "pendente"}</b></p>
          <FormGrid cols={2}><Input name="revenueApprovedBy" label="Responsável que aprova a política (nome/cargo)" /><Textarea name="revenueNotes" label="Observações" defaultValue={rr.notes} /></FormGrid>
        </Card>
        <SubmitButton>Salvar políticas</SubmitButton>
      </ActionForm>
    </>
  );
}
