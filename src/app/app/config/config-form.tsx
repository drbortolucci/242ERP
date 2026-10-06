"use client";
import { ActionForm, Checkbox, FormGrid, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import type { ConfigField } from "@/modules/config/registry";
import { saveConfigAction } from "./actions";

export function ConfigForm({ entityKey, id, fields, values, lookups }: { entityKey: string; id?: string; fields: ConfigField[]; values?: Record<string, string | boolean | string[]>; lookups: Record<string, { value: string; label: string }[]> }) {
  return (
    <ActionForm action={saveConfigAction} resetOnSuccess={!id}>
      <input type="hidden" name="__key" value={entityKey} />
      {id && <input type="hidden" name="__id" value={id} />}
      <FormGrid cols={2}>
        {fields.map((f) => {
          const v = values?.[f.name];
          switch (f.type) {
            case "bool": return <div key={f.name} className="flex items-end"><Checkbox name={f.name} label={f.label} defaultChecked={!!v} /></div>;
            case "textarea": return <Textarea key={f.name} name={f.name} label={f.label} defaultValue={String(v ?? "")} hint={f.hint} />;
            case "select": return <Select key={f.name} name={f.name} label={f.label} required={f.required} options={f.options ?? []} placeholder="Selecione" defaultValue={String(v ?? "")} hint={f.hint} />;
            case "lookup": return <Select key={f.name} name={f.name} label={f.label} required={f.required} options={lookups[f.name] ?? []} placeholder="—" defaultValue={String(v ?? "")} hint={f.hint} />;
            case "date": return <Input key={f.name} type="date" name={f.name} label={f.label} required={f.required} defaultValue={String(v ?? "")} />;
            case "int": return <Input key={f.name} type="number" step="1" name={f.name} label={f.label} required={f.required} defaultValue={String(v ?? "")} hint={f.hint} />;
            case "decimal": return <Input key={f.name} inputMode="decimal" name={f.name} label={f.label} required={f.required} defaultValue={String(v ?? "")} hint={f.hint} />;
            case "tags": return <Input key={f.name} name={f.name} label={f.label} defaultValue={Array.isArray(v) ? v.join(", ") : ""} hint={f.hint} />;
            default: return <Input key={f.name} name={f.name} label={f.label} required={f.required} defaultValue={String(v ?? "")} hint={f.hint} />;
          }
        })}
      </FormGrid>
      <SubmitButton>{id ? "Salvar alterações" : "Adicionar"}</SubmitButton>
    </ActionForm>
  );
}
