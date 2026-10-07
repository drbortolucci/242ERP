import type { Opt } from "./types";

/** Filtros por GET (competência, empresa, centro de custo, unidade, projeto). */
export function Filters({ from, to, companyId, companies, extra }: { from: string; to?: string; companyId?: string; companies: Opt[]; extra?: React.ReactNode }) {
  return (
    <form className="mb-4 flex flex-wrap items-end gap-2 text-sm" method="get">
      <label className="flex flex-col text-xs">De<input type="month" name="de" defaultValue={from.slice(0, 7)} className="rounded border px-2 py-1 text-sm" /></label>
      {to !== undefined && <label className="flex flex-col text-xs">Até<input type="month" name="ate" defaultValue={to.slice(0, 7)} className="rounded border px-2 py-1 text-sm" /></label>}
      <label className="flex flex-col text-xs">Empresa<select name="empresa" defaultValue={companyId ?? ""} className="rounded border px-2 py-1 text-sm"><option value="">Todas</option>{companies.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
      {extra}
      <button className="rounded bg-slate-800 px-3 py-1.5 text-white">Atualizar</button>
    </form>
  );
}
