"use client";
import { useActionState, startTransition } from "react";
import { moveStageAction } from "../actions";

export function KanbanMove({ id, stages, current }: { id: string; stages: { value: string; label: string }[]; current: string }) {
  const [state, action, pending] = useActionState(moveStageAction, undefined);
  return (
    <div className="mt-1">
      <label className="sr-only" htmlFor={`mv-${id}`}>Mover para etapa</label>
      <select id={`mv-${id}`} disabled={pending} defaultValue={current} className="w-full rounded border border-slate-200 px-1 py-0.5 text-xs"
        onChange={(e) => { const fd = new FormData(); fd.set("id", id); fd.set("stageId", e.target.value); startTransition(() => action(fd)); }}>
        {stages.map((s) => <option key={s.value} value={s.value}>Mover: {s.label}</option>)}
      </select>
      {state?.error && <p role="alert" className="text-xs text-red-700">{state.error}</p>}
    </div>
  );
}
