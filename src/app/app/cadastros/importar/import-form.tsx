"use client";
import { useActionState, startTransition } from "react";
import { importAction } from "./actions";
import { Select } from "@/components/ui/form";

type Row = { row: number; ok: boolean; label: string; errors: string[] };

export function ImportForm({ companies, layouts }: { companies: { value: string; label: string }[]; layouts: { value: string; label: string; columns: readonly string[] }[] }) {
  const [state, action, pending] = useActionState(importAction, undefined);
  const preview = ((state?.data as { preview?: Row[] } | undefined)?.preview ?? []) as Row[];
  return (
    <div className="space-y-4">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter); startTransition(() => action(fd)); }}>
        <Select name="layout" label="Layout" options={layouts.map((l) => ({ value: l.value, label: l.label }))} />
        <Select name="companyId" label="Empresa (para profissionais)" options={companies} placeholder="—" />
        <div><label htmlFor="file" className="text-xs font-medium">Arquivo (.csv ou .xlsx)</label><input id="file" type="file" name="file" accept=".csv,.xlsx" className="block text-sm" /></div>
        <div className="flex gap-2">
          <button name="mode" value="preview" disabled={pending} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">{pending ? "Processando…" : "Pré-visualizar"}</button>
          <button name="mode" value="import" disabled={pending} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white">Importar linhas válidas</button>
        </div>
      </form>
      {state?.error && <div role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">{state.error}</div>}
      {state?.ok && <div role="status" className="rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">{state.message}</div>}
      {preview.length > 0 && (
        <table className="min-w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500"><th>Linha</th><th>Registro</th><th>Resultado</th></tr></thead>
          <tbody>{preview.map((r) => <tr key={r.row} className="border-t"><td className="py-1">{r.row}</td><td>{r.label}</td><td className={r.ok ? "text-emerald-700" : "text-red-700"}>{r.ok ? "OK" : r.errors.join("; ")}</td></tr>)}</tbody>
        </table>
      )}
      <div className="text-xs text-slate-500">
        {layouts.map((l) => <p key={l.value}><b>{l.label}:</b> colunas {l.columns.join(" | ")}</p>)}
      </div>
    </div>
  );
}
