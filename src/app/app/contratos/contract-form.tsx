"use client";
import { ActionForm, Checkbox, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import type { ActionState } from "@/server/action";

type Opt = { value: string; label: string };
const MODELS: Opt[] = [["FIXED_PRICE", "Preço fechado"], ["TIME_MATERIAL", "Time & material"], ["MONTHLY_ALLOCATION", "Alocação mensal"], ["HOUR_PACKAGE", "Pacote de horas"], ["AMS_RECURRING", "AMS recorrente"], ["ADVISORY", "Advisory"], ["TRAINING", "Treinamento"], ["HYBRID", "Híbrido"]].map(([value, label]) => ({ value, label }));
const REV: Opt[] = [["TIME_MATERIAL", "Horas aprovadas × tarifa (T&M)"], ["PERCENT_COMPLETE_HOURS", "% de conclusão por horas (preço fechado)"], ["MILESTONE", "Marcos aceitos"], ["STRAIGHT_LINE", "Linear mensal (recorrente/AMS)"], ["ON_MEASUREMENT", "Na aprovação da medição"]].map(([value, label]) => ({ value, label }));

export function ContractForm({ action, c, hidden, lk, showParty }: { action: (s: ActionState | undefined, fd: FormData) => Promise<ActionState>; c?: Record<string, unknown>; hidden: Record<string, string>; lk: { terms: Opt[]; sla: Opt[]; users: Opt[]; units: Opt[]; ccs: Opt[]; companies?: Opt[]; customers?: Opt[] }; showParty?: boolean }) {
  const v = (k: string, d = "") => (c?.[k] === null || c?.[k] === undefined ? d : c[k] instanceof Date ? (c[k] as Date).toISOString().slice(0, 10) : String(c[k]));
  const b = (k: string) => !!c?.[k];
  return (
    <ActionForm action={action}>
      {Object.entries(hidden).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
      <FormGrid cols={3}>
        {showParty && <Select name="companyId" label="Empresa prestadora" options={lk.companies ?? []} required />}
        {showParty && <Select name="partyId" label="Cliente" options={lk.customers ?? []} required placeholder="Selecione" />}
        <Input name="title" label="Título" required defaultValue={v("title")} />
        <Select name="commercialModel" label="Modelo comercial" options={MODELS} defaultValue={v("commercialModel", "TIME_MATERIAL")} />
        <Select name="revenueMethod" label="Reconhecimento de receita gerencial" options={REV} defaultValue={v("revenueMethod", "TIME_MATERIAL")} />
        <Input name="startDate" type="date" label="Início da vigência" required defaultValue={v("startDate")} />
        <Input name="endDate" type="date" label="Fim da vigência" defaultValue={v("endDate")} />
        <Input name="totalValue" label="Valor contratado" required defaultValue={v("totalValue")} />
        <Input name="hoursLimit" label="Limite de horas" defaultValue={v("hoursLimit")} />
        <Select name="paymentTermId" label="Condição de pagamento" options={lk.terms} placeholder="—" defaultValue={v("paymentTermId")} />
        <Select name="billingFrequency" label="Faturamento" options={[{ value: "MONTHLY", label: "Mensal" }, { value: "MILESTONE", label: "Por marco" }, { value: "ON_DEMAND", label: "Sob demanda" }]} defaultValue={v("billingFrequency", "MONTHLY")} />
        <Input name="billingDay" type="number" label="Dia de corte do faturamento" defaultValue={v("billingDay", "1")} />
        <Select name="overagePolicy" label="Política de excedente" options={[{ value: "REQUIRE_APPROVAL", label: "Exige aprovação (exceção registrada)" }, { value: "BILL", label: "Faturar excedente" }, { value: "BLOCK", label: "Bloquear excedente" }]} defaultValue={v("overagePolicy", "REQUIRE_APPROVAL")} />
        <Input name="taxRatePct" label="Tributos gerenciais estimados (%)" defaultValue={v("taxRatePct", "0")} />
        <Input name="lowBalancePct" type="number" label="Alerta de saldo abaixo de (%)" defaultValue={v("lowBalancePct", "20")} />
        <Input name="adjustmentIndex" label="Índice de reajuste" defaultValue={v("adjustmentIndex")} />
        <Input name="adjustmentMonth" type="number" label="Mês de reajuste" defaultValue={v("adjustmentMonth")} />
        <Input name="renewalNoticeDays" type="number" label="Aviso de renovação (dias)" defaultValue={v("renewalNoticeDays", "60")} />
        <Select name="ownerUserId" label="Responsável" options={lk.users} placeholder="—" defaultValue={v("ownerUserId")} />
        <Select name="businessUnitId" label="Unidade de negócio" options={lk.units} placeholder="—" defaultValue={v("businessUnitId")} />
        <Select name="costCenterId" label="Centro de custo" options={lk.ccs} placeholder="—" defaultValue={v("costCenterId")} />
      </FormGrid>
      <fieldset className="rounded border border-slate-200 p-3"><legend className="px-1 text-xs font-medium">AMS / recorrência / franquia</legend>
        <FormGrid cols={4}>
          <Select name="slaPolicyId" label="Política de SLA" options={lk.sla} placeholder="—" defaultValue={v("slaPolicyId")} />
          <Input name="monthlyFee" label="Mensalidade" defaultValue={v("monthlyFee")} />
          <Input name="franchiseHours" label="Franquia mensal (h)" defaultValue={v("franchiseHours")} />
          <Input name="overageRate" label="Tarifa de excedente (h)" defaultValue={v("overageRate")} />
          <Select name="hourBankPolicy" label="Banco de horas" options={[{ value: "NONE", label: "Sem acúmulo (expira no mês)" }, { value: "ACCUMULATE", label: "Acumula saldo não usado" }, { value: "PREPAID", label: "Pacote pré-pago" }]} placeholder="—" defaultValue={v("hourBankPolicy")} />
          <Input name="hourBankExpiryMonths" type="number" label="Validade do saldo (meses)" defaultValue={v("hourBankExpiryMonths")} />
        </FormGrid>
      </fieldset>
      <div className="flex flex-wrap gap-4">
        <Checkbox name="requiresClientTimesheetApproval" label="Horas exigem aprovação do cliente" defaultChecked={b("requiresClientTimesheetApproval")} />
        <Checkbox name="requiresClientMeasurementApproval" label="Medição exige aprovação do cliente" defaultChecked={b("requiresClientMeasurementApproval")} />
        <Checkbox name="requiresPo" label="Exige ordem de compra do cliente" defaultChecked={b("requiresPo")} />
        <Checkbox name="autoRenew" label="Renovação automática" defaultChecked={b("autoRenew")} />
      </div>
      <SubmitButton>{c?.id ? "Salvar" : "Criar contrato"}</SubmitButton>
    </ActionForm>
  );
}
