"use client";
import { ActionForm, Checkbox, FormGrid, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { createActivityAction } from "./actions";
import { ACTIVITY_TYPES } from "./constants";


export function ActivityForm({ back, partyId, opportunityId, leadId, projectId }: { back: string; partyId?: string; opportunityId?: string; leadId?: string; projectId?: string }) {
  return (
    <ActionForm action={createActivityAction} resetOnSuccess>
      <input type="hidden" name="back" value={back} />
      {partyId && <input type="hidden" name="partyId" value={partyId} />}
      {opportunityId && <input type="hidden" name="opportunityId" value={opportunityId} />}
      {leadId && <input type="hidden" name="leadId" value={leadId} />}
      {projectId && <input type="hidden" name="projectId" value={projectId} />}
      <FormGrid cols={2}>
        <Select name="type" label="Tipo" options={ACTIVITY_TYPES} />
        <Input name="dueAt" type="datetime-local" label="Data/hora (próxima ação)" />
      </FormGrid>
      <Input name="subject" label="Assunto" required />
      <Textarea name="notes" label="Registro da interação" />
      <Checkbox name="done" label="Já realizada" />
      <SubmitButton variant="secondary">Registrar</SubmitButton>
    </ActionForm>
  );
}
