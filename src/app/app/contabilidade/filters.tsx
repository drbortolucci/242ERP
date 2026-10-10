import { monthStart, todayIn } from "@/lib/dates";
import type { SearchParams } from "@/lib/query";
import { sp } from "@/lib/query";

/** Filtro comum dos relatórios: empresa (ou consolidado) e período. */
export function periodFrom(s: SearchParams, tz: string) {
  const today = todayIn(tz);
  const from = sp(s, "de") ?? monthStart(today);
  const to = sp(s, "ate") ?? today;
  const companyId = sp(s, "empresa") ?? null;
  return { from, to, companyId };
}

export function FilterBar({ base, companies, from, to, companyId, single }: { base: string; companies: { value: string; label: string }[]; from?: string; to: string; companyId: string | null; single?: boolean }) {
  return (
    <form method="get" action={base} className="mb-4 flex flex-wrap items-end gap-2 text-sm">
      <label className="flex flex-col"><span className="text-xs text-slate-500">Empresa</span>
        <select name="empresa" defaultValue={companyId ?? ""} className="rounded border border-slate-300 px-2 py-1"><option value="">Consolidado (todas)</option>{companies.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
      </label>
      {!single && <label className="flex flex-col"><span className="text-xs text-slate-500">De</span><input type="date" name="de" defaultValue={from} className="rounded border border-slate-300 px-2 py-1" /></label>}
      <label className="flex flex-col"><span className="text-xs text-slate-500">{single ? "Data" : "Até"}</span><input type="date" name="ate" defaultValue={to} className="rounded border border-slate-300 px-2 py-1" /></label>
      <button className="rounded bg-slate-800 px-3 py-1.5 text-white">Atualizar</button>
    </form>
  );
}
