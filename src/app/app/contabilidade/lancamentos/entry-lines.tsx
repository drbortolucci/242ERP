"use client";
import { useState } from "react";

const cls = "w-full rounded border border-slate-300 px-2 py-1 text-sm";
const num = (s: string) => { const v = s.trim(); const n = Number(v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v); return Number.isFinite(n) ? n : 0; };

/** Linhas do lançamento manual com totais de débito e crédito. */
export function EntryLines({ accounts }: { accounts: { value: string; label: string }[] }) {
  const [rows, setRows] = useState([{ k: 0, d: "", c: "" }, { k: 1, d: "", c: "" }]);
  const td = rows.reduce((a, r) => a + num(r.d), 0), tc = rows.reduce((a, r) => a + num(r.c), 0);
  const ok = Math.abs(td - tc) < 0.005 && td > 0;
  return (
    <fieldset className="rounded border border-slate-200 p-3">
      <legend className="px-1 text-xs font-medium">Partidas</legend>
      {rows.map((r) => (
        <div key={r.k} className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-6">
          <select name="lineAccount[]" aria-label="Conta" className={`${cls} md:col-span-2`} defaultValue=""><option value="">Conta…</option>{accounts.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select>
          <input name="lineDebit[]" aria-label="Débito" placeholder="Débito" className={cls} value={r.d} onChange={(e) => setRows(rows.map((x) => (x.k === r.k ? { ...x, d: e.target.value } : x)))} />
          <input name="lineCredit[]" aria-label="Crédito" placeholder="Crédito" className={cls} value={r.c} onChange={(e) => setRows(rows.map((x) => (x.k === r.k ? { ...x, c: e.target.value } : x)))} />
          <input name="lineMemo[]" aria-label="Histórico da linha" placeholder="Histórico" className={cls} />
          {rows.length > 2 ? <button type="button" className="text-left text-xs text-red-700" onClick={() => setRows(rows.filter((x) => x.k !== r.k))}>remover</button> : <span />}
        </div>
      ))}
      <div className="flex items-center justify-between text-sm">
        <button type="button" className="text-xs text-brand-700" onClick={() => setRows([...rows, { k: Math.max(...rows.map((x) => x.k)) + 1, d: "", c: "" }])}>+ partida</button>
        <span className={ok ? "text-emerald-700" : "text-amber-700"}>Débitos {td.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} · Créditos {tc.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}{ok ? " ✓" : " — deve fechar"}</span>
      </div>
    </fieldset>
  );
}
