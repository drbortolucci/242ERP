/**
 * Detecção do tipo real do arquivo pelo conteúdo (assinatura/"magic numbers") — não confia na extensão.
 */
export interface Sniffed {
  mime: string;
  ext: string;
}

const startsWith = (b: Buffer, sig: number[], offset = 0) => sig.every((x, i) => b[offset + i] === x);

export function sniffFile(buf: Buffer, declaredName: string): Sniffed | null {
  if (buf.length < 4) return isText(buf) ? textType(declaredName) : null;
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return { mime: "application/pdf", ext: "pdf" };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return { mime: "image/png", ext: "png" };
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return { mime: "image/gif", ext: "gif" };
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return { mime: "image/webp", ext: "webp" };
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    // ZIP: aceita somente formatos Office Open XML
    const s = buf.subarray(0, Math.min(buf.length, 4000)).toString("latin1");
    const lower = declaredName.toLowerCase();
    if (s.includes("word/") || lower.endsWith(".docx")) return { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" };
    if (s.includes("xl/") || lower.endsWith(".xlsx")) return { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" };
    if (s.includes("ppt/") || lower.endsWith(".pptx")) return { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: "pptx" };
    return null;
  }
  if (isText(buf)) return textType(declaredName);
  return null;
}

function isText(buf: Buffer) {
  const sample = buf.subarray(0, Math.min(buf.length, 2000));
  for (const c of sample) if (c === 0) return false;
  return true;
}

function textType(name: string): Sniffed | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) return { mime: "text/csv", ext: "csv" };
  if (lower.endsWith(".ofx")) return { mime: "application/x-ofx", ext: "ofx" };
  if (lower.endsWith(".txt")) return { mime: "text/plain", ext: "txt" };
  if (lower.endsWith(".xml")) return { mime: "application/xml", ext: "xml" };
  return null; // texto sem extensão permitida (ex.: .html, .js, .svg) é recusado
}

export const ALLOWED_DESCRIPTION = "PDF, PNG, JPG, GIF, WEBP, DOCX, XLSX, PPTX, CSV, OFX, TXT, XML";
