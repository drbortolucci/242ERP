"use client";
import { ActionForm, Checkbox, FormGrid, Input, SubmitButton } from "@/components/ui/form";
import { saveContactAction } from "./actions";

export function ContactForm({ partyId, back, roles, contact }: { partyId: string; back: string; roles: { value: string; label: string }[]; contact?: { id: string; name: string; email: string | null; phone: string | null; jobTitle: string | null; roles: string[] } }) {
  return (
    <ActionForm action={saveContactAction} resetOnSuccess={!contact}>
      <input type="hidden" name="partyId" value={partyId} />
      <input type="hidden" name="back" value={back} />
      {contact && <input type="hidden" name="id" value={contact.id} />}
      <FormGrid cols={2}>
        <Input name="name" label="Nome" required defaultValue={contact?.name} />
        <Input name="jobTitle" label="Cargo" defaultValue={contact?.jobTitle ?? ""} />
        <Input name="email" type="email" label="E-mail" defaultValue={contact?.email ?? ""} />
        <Input name="phone" label="Telefone" defaultValue={contact?.phone ?? ""} />
      </FormGrid>
      <fieldset className="flex flex-wrap gap-3"><legend className="mb-1 text-xs font-medium">Papéis do contato</legend>
        {roles.map((r) => <Checkbox key={r.value} name="roles[]" value={r.value} label={r.label} defaultChecked={contact?.roles.includes(r.value)} />)}
      </fieldset>
      <SubmitButton variant="secondary">{contact ? "Salvar contato" : "Adicionar contato"}</SubmitButton>
    </ActionForm>
  );
}
