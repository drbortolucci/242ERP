"use client";
import { useActionState } from "react";
import { importStatementAction } from "../actions";

export function StatementForm({ accounts }: { accounts: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState(importStatementAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <div><label htmlFor="bankAccountId" className="text-xs font-medium">Conta bancária</label><select id="bankAccountId" name="bankAccountId" className="block w-full rounded border px-2 py-1 text-sm">{accounts.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select></div>
      <div><label htmlFor="file" className="text-xs font-medium">Extrato (.csv ou .ofx)</label><input id="file" type="file" name="file" accept=".csv,.ofx,.txt" className="block text-sm" /></div>
      <button disabled={pending} className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white">{pending ? "Importando…" : "Importar extrato"}</button>
      {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state?.message && <p className="text-sm text-emerald-700">{state.message}</p>}
      <p className="text-xs text-slate-500">CSV: data;descrição;valor (identificador opcional na 4ª coluna). Reimportar o mesmo arquivo não duplica lançamentos.</p>
    </form>
  );
}
