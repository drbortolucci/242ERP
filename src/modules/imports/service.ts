import ExcelJS from "exceljs";
import { ZodError } from "zod";
import { requirePerm, type Ctx } from "@/server/context";
import { toAppError, validation } from "@/lib/errors";
import { partySchema, createParty, findDuplicate } from "../parties/service";
import { professionalSchema, createProfessional } from "../professionals/service";
import { audit } from "@/server/audit";

/** Leitura de CSV (separador ; ou ,) com suporte a aspas. */
export function parseCsv(text: string): string[][] {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = clean.split(/\r?\n/)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (q) {
      if (c === '"' && clean[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

export async function parseSheet(fileName: string, data: Buffer): Promise<Record<string, string>[]> {
  let matrix: string[][];
  if (fileName.toLowerCase().endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw validation("Planilha vazia.");
    matrix = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const vals = (r.values as unknown[]).slice(1).map((v) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "object" && v && "text" in v ? String((v as { text: string }).text) : String(v)));
      matrix.push(vals);
    });
  } else if (fileName.toLowerCase().endsWith(".csv")) {
    matrix = parseCsv(data.toString("utf8"));
  } else throw validation("Envie um arquivo .csv ou .xlsx.");
  if (matrix.length < 2) throw validation("A planilha precisa de cabeçalho e ao menos uma linha.");
  if (matrix.length > 5001) throw validation("Máximo de 5.000 linhas por importação.");
  const header = matrix[0].map((h) => h.trim());
  return matrix.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const yes = (v: string) => (["sim", "s", "1", "x", "true", "yes"].includes((v ?? "").toLowerCase()) ? "on" : "");

/** Layouts de importação: colunas esperadas e conversão para o formato do formulário. */
export const IMPORT_LAYOUTS = {
  clientes: {
    title: "Clientes, prospects, fornecedores e parceiros",
    columns: ["nome", "nome_fantasia", "tipo_pessoa(PJ/PF)", "documento", "email", "telefone", "cidade", "uf", "cliente(sim/nao)", "prospect(sim/nao)", "fornecedor(sim/nao)", "parceiro(sim/nao)", "segmento"],
    map: (r: Record<string, string>) => ({
      name: r["nome"], tradeName: r["nome_fantasia"], personType: (r["tipo_pessoa(PJ/PF)"] || "PJ").toUpperCase() === "PF" ? "PERSON" : "COMPANY",
      document: r["documento"], email: r["email"], phone: r["telefone"], city: r["cidade"], state: r["uf"], segment: r["segmento"],
      isCustomer: yes(r["cliente(sim/nao)"]), isProspect: yes(r["prospect(sim/nao)"]), isSupplier: yes(r["fornecedor(sim/nao)"]), isPartner: yes(r["parceiro(sim/nao)"]),
    }),
  },
  profissionais: {
    title: "Profissionais",
    columns: ["nome", "email", "vinculo(CLT/PJ/PARTNER/OTHER)", "capacidade_pct", "certificacoes"],
    map: (r: Record<string, string>, companyId: string) => ({
      companyId, name: r["nome"], email: r["email"], employmentType: (r["vinculo(CLT/PJ/PARTNER/OTHER)"] || "CLT").toUpperCase(), capacityPct: r["capacidade_pct"] || "100", certifications: r["certificacoes"] ?? "",
    }),
  },
} as const;
export type ImportLayout = keyof typeof IMPORT_LAYOUTS;

export interface RowResult {
  row: number;
  ok: boolean;
  label: string;
  errors: string[];
}

export async function previewImport(ctx: Ctx, layout: ImportLayout, rows: Record<string, string>[], companyId?: string): Promise<RowResult[]> {
  requirePerm(ctx, "master.write");
  const results: RowResult[] = [];
  const seenDocs = new Set<string>();
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const errors: string[] = [];
    let label = r["nome"] || `linha ${idx + 2}`;
    try {
      if (layout === "clientes") {
        const data = partySchema.parse(IMPORT_LAYOUTS.clientes.map(r));
        label = data.name;
        const dup = await findDuplicate(ctx, data);
        if (dup) errors.push(`Duplicidade com cadastro existente "${dup.name}"`);
        if (data.document) {
          if (seenDocs.has(data.document)) errors.push("Documento repetido na planilha");
          seenDocs.add(data.document);
        }
      } else {
        if (!companyId) throw validation("Selecione a empresa dos profissionais.");
        professionalSchema.parse(IMPORT_LAYOUTS.profissionais.map(r, companyId));
      }
    } catch (e) {
      if (e instanceof ZodError) errors.push(...e.issues.map((i) => `${i.path.join(".") || "linha"}: ${i.message}`));
      else errors.push(toAppError(e).message);
    }
    results.push({ row: idx + 2, ok: errors.length === 0, label, errors });
  }
  return results;
}

/** Importa somente as linhas válidas; cada linha usa o mesmo caso de uso do cadastro manual. */
export async function runImport(ctx: Ctx, layout: ImportLayout, rows: Record<string, string>[], companyId?: string) {
  const preview = await previewImport(ctx, layout, rows, companyId);
  let created = 0;
  const failures: RowResult[] = preview.filter((p) => !p.ok);
  for (let i = 0; i < rows.length; i++) {
    if (!preview[i].ok) continue;
    try {
      if (layout === "clientes") await createParty(ctx, partySchema.parse(IMPORT_LAYOUTS.clientes.map(rows[i])));
      else await createProfessional(ctx, professionalSchema.parse(IMPORT_LAYOUTS.profissionais.map(rows[i], companyId!)));
      created++;
    } catch (e) {
      failures.push({ row: preview[i].row, ok: false, label: preview[i].label, errors: [toAppError(e).message] });
    }
  }
  await audit(ctx, { action: "import.run", entity: layout, changes: { created, failed: failures.length } });
  return { created, failures };
}
