"use client";
import { ActionForm, SubmitButton } from "./ui/form";
import { uploadAction } from "@/app/app/_shared/actions";

export function UploadForm({ entity, entityId, back, allowClientVisibility }: { entity: string; entityId: string; back: string; allowClientVisibility?: boolean }) {
  return (
    <ActionForm action={uploadAction} resetOnSuccess className="space-y-2">
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="entityId" value={entityId} />
      <input type="hidden" name="back" value={back} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`file-${entityId}`}>Arquivo</label>
        <input id={`file-${entityId}`} type="file" name="file" className="text-sm" />
        <select name="visibility" className="rounded border border-slate-300 px-2 py-1 text-sm" aria-label="Visibilidade">
          <option value="INTERNAL">Interno</option>
          {allowClientVisibility && <option value="CLIENT">Visível ao cliente</option>}
          <option value="RESTRICTED">Restrito (sigiloso)</option>
        </select>
        <SubmitButton variant="secondary">Anexar</SubmitButton>
      </div>
    </ActionForm>
  );
}
