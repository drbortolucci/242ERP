"use client";
import { ActionForm, Checkbox, FormGrid, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { savePartyAction } from "./actions";

type Opt = { value: string; label: string };
type CF = { key: string; label: string; type: string; options: string[]; required: boolean };

export function PartyForm({ party, back, defaults, users, terms, customFields }: {
  party?: Record<string, unknown> & { address?: Record<string, string>; customFields?: Record<string, unknown> }; back: string;
  defaults?: { isCustomer?: boolean; isSupplier?: boolean; isPartner?: boolean; isProspect?: boolean }; users: Opt[]; terms: Opt[]; customFields: CF[];
}) {
  const v = (k: string) => String(party?.[k] ?? "");
  const a = party?.address ?? {};
  const b = (k: string) => (party ? !!party[k] : !!defaults?.[k as keyof typeof defaults]);
  const cf = party?.customFields ?? {};
  return (
    <ActionForm action={savePartyAction}>
      {party?.id ? <input type="hidden" name="id" value={String(party.id)} /> : null}
      <input type="hidden" name="back" value={back} />
      <fieldset className="flex flex-wrap gap-4 rounded border border-slate-200 p-3">
        <legend className="px-1 text-xs font-medium text-slate-700">Papéis (saldos e históricos permanecem separados por papel)</legend>
        <Checkbox name="isCustomer" label="Cliente" defaultChecked={b("isCustomer")} />
        <Checkbox name="isProspect" label="Prospect" defaultChecked={b("isProspect")} />
        <Checkbox name="isSupplier" label="Fornecedor" defaultChecked={b("isSupplier")} />
        <Checkbox name="isPartner" label="Parceiro/canal" defaultChecked={b("isPartner")} />
      </fieldset>
      <FormGrid cols={3}>
        <Select name="personType" label="Tipo de pessoa" options={[{ value: "COMPANY", label: "Jurídica" }, { value: "PERSON", label: "Física" }]} defaultValue={v("personType") || "COMPANY"} />
        <Input name="name" label="Nome / razão social" required defaultValue={v("name")} />
        <Input name="tradeName" label="Nome fantasia" defaultValue={v("tradeName")} />
        <Input name="document" label="CNPJ/CPF" defaultValue={v("document")} hint="Validado por dígitos verificadores; usado na detecção de duplicidade." />
        <Input name="email" type="email" label="E-mail" defaultValue={v("email")} />
        <Input name="phone" label="Telefone" defaultValue={v("phone")} />
        <Input name="website" label="Site" defaultValue={v("website")} />
        <Input name="segment" label="Segmento" defaultValue={v("segment")} />
        <Select name="ownerUserId" label="Responsável interno" options={users} placeholder="—" defaultValue={v("ownerUserId")} />
        <Select name="paymentTermId" label="Condição de pagamento" options={terms} placeholder="—" defaultValue={v("paymentTermId")} />
        <Input name="street" label="Logradouro" defaultValue={a.street ?? ""} />
        <Input name="number" label="Número" defaultValue={a.number ?? ""} />
        <Input name="district" label="Bairro" defaultValue={a.district ?? ""} />
        <Input name="city" label="Cidade" defaultValue={a.city ?? ""} />
        <Input name="state" label="UF" maxLength={2} defaultValue={a.state ?? ""} />
        <Input name="zip" label="CEP" defaultValue={a.zip ?? ""} />
        {customFields.map((f) => {
          const val = cf[f.key];
          const name = `cf_${f.key}`;
          if (f.type === "BOOLEAN") return <div key={f.key} className="flex items-end"><Checkbox name={name} label={f.label} defaultChecked={!!val} /></div>;
          if (f.type === "SELECT") return <Select key={f.key} name={name} label={f.label} required={f.required} options={f.options.map((o) => ({ value: o, label: o }))} placeholder="—" defaultValue={String(val ?? "")} />;
          return <Input key={f.key} name={name} label={f.label} required={f.required} type={f.type === "DATE" ? "date" : "text"} inputMode={f.type === "NUMBER" ? "decimal" : undefined} defaultValue={String(val ?? "")} />;
        })}
      </FormGrid>
      <Textarea name="notes" label="Observações" defaultValue={v("notes")} />
      <SubmitButton>{party?.id ? "Salvar alterações" : "Cadastrar"}</SubmitButton>
    </ActionForm>
  );
}
