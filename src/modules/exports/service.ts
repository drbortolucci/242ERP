import ExcelJS from "exceljs";
import { requireAnyPerm, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { notFound } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";

export interface ExportColumn {
  key: string;
  label: string;
}
export interface Dataset {
  perms: Permission[];
  title: string;
  columns: ExportColumn[];
  rows: (ctx: Ctx, params: URLSearchParams) => Promise<Record<string, unknown>[]>;
}

const registry = new Map<string, Dataset>();
export function registerDataset(key: string, d: Dataset) {
  registry.set(key, d);
}
export function getDataset(key: string) {
  return registry.get(key);
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

/** Exporta dataset autorizado (permissão verificada no servidor, dados do tenant via ctx.db). */
export async function exportDataset(ctx: Ctx, key: string, format: "csv" | "xlsx", params: URLSearchParams) {
  const d = registry.get(key);
  if (!d) throw notFound("Exportação");
  requireAnyPerm(ctx, ...d.perms);
  const rows = await d.rows(ctx, params);
  await audit(ctx, { action: "data.export", entity: key, changes: { format, rows: rows.length } });
  if (format === "csv") {
    const esc = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [d.columns.map((c) => esc(c.label)).join(";"), ...rows.map((r) => d.columns.map((c) => esc(cell(r[c.key]))).join(";"))];
    return { body: Buffer.from(String.fromCharCode(0xfeff) + lines.join("\r\n"), "utf8"), mime: "text/csv; charset=utf-8", fileName: `${key}.csv` };
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(d.title.slice(0, 31));
  ws.columns = d.columns.map((c) => ({ header: c.label, key: c.key, width: 22 }));
  for (const r of rows) ws.addRow(Object.fromEntries(d.columns.map((c) => [c.key, cell(r[c.key])])));
  ws.getRow(1).font = { bold: true };
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return { body: buf, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName: `${key}.xlsx` };
}
