import Link from "@/components/ui/access-link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { withParams, type SearchParams } from "@/lib/query";
import { EmptyState } from "./page";

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}

export function DataTable<T extends { id?: string }>({ columns, rows, empty, rowHref, footer, dense }: {
  columns: Column<T>[]; rows: T[]; empty?: ReactNode; rowHref?: (row: T) => string | undefined; footer?: ReactNode; dense?: boolean;
}) {
  if (rows.length === 0) return <>{empty ?? <EmptyState title="Nenhum registro encontrado" description="Ajuste os filtros ou cadastre um novo registro." />}</>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn("px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600", c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left")}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => {
            const href = rowHref?.(r);
            return (
              <tr key={r.id ?? i} className="hover:bg-slate-50">
                {columns.map((c, ci) => {
                  const content = c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? "—");
                  return (
                    <td key={c.key} className={cn(dense ? "px-3 py-1" : "px-3 py-2", c.align === "right" ? "text-right tabular-nums" : c.align === "center" ? "text-center" : "", c.className)}>
                      {href && ci === 0 ? <Link className="font-medium text-brand-700 hover:underline" href={href}>{content}</Link> : content}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        {footer && <tfoot className="bg-slate-50 font-medium">{footer}</tfoot>}
      </table>
    </div>
  );
}

export function Pagination({ base, params, page, pageSize, total }: { base: string; params: SearchParams; page: number; pageSize: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  return (
    <nav aria-label="Paginação" className="mt-3 flex items-center justify-between text-sm text-slate-600">
      <span>{total} registro(s) · página {page} de {pages}</span>
      <div className="flex gap-2">
        {page > 1 ? <Link className="rounded border px-2 py-1 hover:bg-slate-50" href={withParams(base, params, { page: page - 1 })}>Anterior</Link> : <span className="rounded border px-2 py-1 opacity-40">Anterior</span>}
        {page < pages ? <Link className="rounded border px-2 py-1 hover:bg-slate-50" href={withParams(base, params, { page: page + 1 })}>Próxima</Link> : <span className="rounded border px-2 py-1 opacity-40">Próxima</span>}
      </div>
    </nav>
  );
}

/** Barra de busca/filtros via GET (URL compartilhável; pode ser salva como filtro). */
export function Toolbar({ base, params, filters, children, exportHref }: {
  base: string; params: SearchParams; filters?: { name: string; label: string; options: { value: string; label: string }[] }[]; children?: ReactNode; exportHref?: string;
}) {
  const val = (k: string) => { const v = params[k]; return Array.isArray(v) ? v[0] : v ?? ""; };
  return (
    <div className="mb-3 flex flex-wrap items-end gap-2">
      <form method="get" action={base} className="flex flex-wrap items-end gap-2" role="search">
        <div>
          <label htmlFor="q" className="sr-only">Buscar</label>
          <input id="q" name="q" defaultValue={val("q")} placeholder="Buscar…" className="w-56 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
        </div>
        {filters?.map((f) => (
          <div key={f.name}>
            <label htmlFor={`f-${f.name}`} className="sr-only">{f.label}</label>
            <select id={`f-${f.name}`} name={f.name} defaultValue={val(f.name)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" aria-label={f.label}>
              <option value="">{f.label}: todos</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        ))}
        <button className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50" type="submit">Filtrar</button>
      </form>
      {exportHref && (
        <div className="flex gap-1">
          <a className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50" href={`${exportHref}${exportHref.includes("?") ? "&" : "?"}format=csv`}>CSV</a>
          <a className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50" href={`${exportHref}${exportHref.includes("?") ? "&" : "?"}format=xlsx`}>XLSX</a>
        </div>
      )}
      {children}
    </div>
  );
}

export function TotalRow({ cells }: { cells: ReactNode[] }) {
  return <tr>{cells.map((c, i) => <td key={i} className="px-3 py-2 text-right tabular-nums first:text-left">{c}</td>)}</tr>;
}
