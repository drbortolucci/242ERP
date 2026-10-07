/**
 * Leitura de extratos bancários: CSV (data;descrição;valor — vírgula ou ponto decimal; data DD/MM/AAAA ou AAAA-MM-DD;
 * identificador opcional na 4ª coluna) e OFX (STMTTRN: DTPOSTED, TRNAMT, FITID, MEMO/NAME).
 * Sem identificador, gera um id determinístico (data|valor|descrição|ocorrência) para evitar importação em duplicidade.
 */
import { createHash } from "node:crypto";

export interface StatementLine { externalId: string; date: string; amount: string; description: string }

function parseAmount(s: string): string {
  let v = s.trim().replace(/\s|R\$/g, "");
  if (/,\d{1,2}$/.test(v)) v = v.replace(/\./g, "").replace(",", ".");
  else v = v.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(v)) throw new Error(`Valor inválido: ${s}`);
  return Number(v).toFixed(2);
}
function parseDate(s: string): string {
  const t = s.trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})(\d{2})(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  throw new Error(`Data inválida: ${s}`);
}
const syntheticId = (date: string, amount: string, desc: string, n: number) => createHash("sha256").update(`${date}|${amount}|${desc}|${n}`).digest("hex").slice(0, 24);

export function parseStatement(fileName: string, text: string): StatementLine[] {
  const seen = new Map<string, number>();
  const withId = (date: string, amount: string, description: string, id?: string) => {
    if (id) return { externalId: id, date, amount, description };
    const k = `${date}|${amount}|${description}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return { externalId: syntheticId(date, amount, description, n), date, amount, description };
  };
  if (/\.ofx$/i.test(fileName) || /<OFX>/i.test(text)) {
    const out: StatementLine[] = [];
    for (const block of text.split(/<STMTTRN>/i).slice(1)) {
      const tag = (t: string) => new RegExp(`<${t}>([^<\\r\\n]*)`, "i").exec(block)?.[1]?.trim();
      const date = tag("DTPOSTED");
      const amt = tag("TRNAMT");
      if (!date || !amt) continue;
      out.push(withId(parseDate(date), parseAmount(amt), tag("MEMO") || tag("NAME") || "Lançamento", tag("FITID")));
    }
    return out;
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: StatementLine[] = [];
  for (const [idx, line] of lines.entries()) {
    const cols = line.split(line.includes(";") ? ";" : ",").map((c) => c.replace(/^"|"$/g, "").trim());
    if (idx === 0 && /data|date/i.test(cols[0])) continue; // cabeçalho
    if (cols.length < 3) throw new Error(`Linha ${idx + 1}: esperado data;descrição;valor`);
    out.push(withId(parseDate(cols[0]), parseAmount(cols[2]), cols[1], cols[3] || undefined));
  }
  return out;
}
