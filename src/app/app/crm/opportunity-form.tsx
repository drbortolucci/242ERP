"use client";
import { useState } from "react";
import { ActionForm, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import type { ActionState } from "@/server/action";

type Opt = { value: string; label: string };
const MODELS: Opt[] = [["FIXED_PRICE", "Preço fechado"], ["TIME_MATERIAL", "Time & material"], ["MONTHLY_ALLOCATION", "Alocação mensal"], ["HOUR_PACKAGE", "Pacote de horas"], ["AMS_RECURRING", "AMS recorrente"], ["ADVISORY", "Advisory"], ["TRAINING", "Treinamento"], ["HYBRID", "Híbrido"]].map(([value, label]) => ({ value, label }));

export function OpportunityForm({ action, lk, o, items = [] }: { action: (s: ActionState | undefined, fd: FormData) => Promise<ActionState>; lk: { companies: Opt[]; customers: Opt[]; stages: Opt[]; users: Opt[]; partners: Opt[]; services: Opt[] }; o?: Record<string, unknown>; items?: { serviceId: string; commercialModel: string; estimatedValue: string }[] }) {
  const [rows, setRows] = useState(items.length ? items : [{ serviceId: "", commercialModel: "TIME_MATERIAL", estimatedValue: "" }]);
  const v = (k: string) => (o?.[k] === null || o?.[k] === undefined ? "" : o[k] instanceof Date ? (o[k] as Date).toISOString().slice(0, 10) : String(o[k]));
  return (
    <ActionForm action={action}>
      {o?.id ? <input type="hidden" name="id" value={String(o.id)} /> : null}
      <FormGrid cols={3}>
        <Input name="title" label="Título" required defaultValue={v("title")} />
        <Select name="partyId" label="Cliente/prospect" options={lk.customers} placeholder="Selecione" required defaultValue={v("partyId")} />
        {!o?.id ? <Select name="companyId" label="Empresa que vende" options={lk.companies} placeholder="Selecione" required /> : <input type="hidden" name="companyId" value={v("companyId")} />}
        {!o?.id && <Select name="stageId" label="Etapa" options={lk.stages} />}
        <Input name="estimatedValue" label="Valor estimado (se sem itens)" defaultValue={v("estimatedValue")} />
        <Input name="probability" type="number" label="Probabilidade % (vazio = da etapa)" defaultValue={v("probability")} />
        <Input name="expectedCloseDate" type="date" label="Previsão de fechamento" defaultValue={v("expectedCloseDate")} />
        <Input name="source" label="Origem" defaultValue={v("source")} />
        <Select name="ownerUserId" label="Responsável" options={lk.users} placeholder="Eu" defaultValue={v("ownerUserId")} />
        <Select name="partnerPartyId" label="Parceiro/canal" options={lk.partners} placeholder="—" defaultValue={v("partnerPartyId")} />
        <Select name="kind" label="Tipo de negócio" options={[{ value: "NEW", label: "Novo" }, { value: "RENEWAL", label: "Renovação" }, { value: "UPSELL", label: "Upsell" }, { value: "CROSS_SELL", label: "Cross-sell" }]} defaultValue={v("kind") || "NEW"} />
        <Input name="competitors" label="Concorrentes (vírgula)" defaultValue={Array.isArray(o?.competitors) ? (o!.competitors as string[]).join(", ") : ""} />
        <Input name="nextAction" label="Próxima ação" defaultValue={v("nextAction")} />
        <Input name="nextActionDate" type="date" label="Data da próxima ação" defaultValue={v("nextActionDate")} />
      </FormGrid>
      <fieldset className="rounded border border-slate-200 p-3">
        <legend className="px-1 text-xs font-medium">Serviços e modelos de contratação</legend>
        {rows.map((r, i) => (
          <div key={i} className="mb-2 grid grid-cols-1 gap-2 md:grid-cols-4">
            <Select name="serviceIds[]" options={lk.services} placeholder="Serviço" defaultValue={r.serviceId} aria-label="Serviço" />
            <Select name="itemModels[]" options={MODELS} defaultValue={r.commercialModel} aria-label="Modelo" />
            <Input name="itemValues[]" placeholder="Valor estimado" defaultValue={r.estimatedValue} aria-label="Valor" />
            <button type="button" className="text-left text-xs text-red-700" onClick={() => setRows(rows.filter((_, j) => j !== i))}>remover</button>
          </div>
        ))}
        <button type="button" className="text-xs text-brand-700" onClick={() => setRows([...rows, { serviceId: "", commercialModel: "TIME_MATERIAL", estimatedValue: "" }])}>+ adicionar serviço</button>
      </fieldset>
      <SubmitButton>{o?.id ? "Salvar" : "Criar oportunidade"}</SubmitButton>
    </ActionForm>
  );
}
