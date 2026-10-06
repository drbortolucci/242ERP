"use client";
import { ActionForm, SubmitButton } from "./ui/form";
import { decideAction } from "@/app/app/aprovacoes/actions";

export function DecideForm({ id, back }: { id: string; back?: string }) {
  return (
    <ActionForm action={decideAction} className="mt-2 space-y-2">
      <input type="hidden" name="id" value={id} />
      {back && <input type="hidden" name="back" value={back} />}
      <label className="sr-only" htmlFor={`c-${id}`}>Comentário</label>
      <input id={`c-${id}`} name="comment" placeholder="Comentário (obrigatório para rejeitar)" className="w-full rounded border border-slate-300 px-2 py-1 text-sm" />
      <div className="flex gap-2">
        <SubmitButton name="decision" value="approve">Aprovar</SubmitButton>
        <SubmitButton name="decision" value="reject" variant="danger">Rejeitar</SubmitButton>
      </div>
    </ActionForm>
  );
}
