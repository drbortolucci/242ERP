import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/** Gerador simples de PDF (A4) para documentos internos: propostas, medições, documentos de cobrança. */
const W = 595.28, H = 841.89, M = 48;

function clean(s: string) {
  // Fontes padrão usam WinAnsi: substitui caracteres fora do conjunto
  return (s ?? "").replace(/[≥]/g, ">=").replace(/[≤]/g, "<=").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\xFF\n—–•…€]/g, "?");
}

export class PdfBuilder {
  private doc!: PDFDocument;
  private page!: PDFPage;
  private font!: PDFFont;
  private bold!: PDFFont;
  private y = H - M;
  private footerText = "";

  static async create(footer = "") {
    const b = new PdfBuilder();
    b.doc = await PDFDocument.create();
    b.font = await b.doc.embedFont(StandardFonts.Helvetica);
    b.bold = await b.doc.embedFont(StandardFonts.HelveticaBold);
    b.footerText = footer;
    b.newPage();
    return b;
  }
  private newPage() {
    this.page = this.doc.addPage([W, H]);
    this.y = H - M;
    if (this.footerText) this.page.drawText(clean(this.footerText), { x: M, y: 24, size: 7, font: this.font, color: rgb(0.4, 0.4, 0.4) });
  }
  private ensure(h: number) {
    if (this.y - h < M) this.newPage();
  }
  private wrap(text: string, size: number, width: number, font = this.font) {
    const words = clean(text).split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) > width && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  title(text: string, sub?: string) {
    this.ensure(40);
    this.page.drawText(clean(text), { x: M, y: this.y - 18, size: 16, font: this.bold });
    this.y -= 26;
    if (sub) { this.page.drawText(clean(sub), { x: M, y: this.y - 10, size: 9, font: this.font, color: rgb(0.35, 0.35, 0.35) }); this.y -= 16; }
    this.y -= 6;
    return this;
  }
  banner(text: string) {
    this.ensure(28);
    this.page.drawRectangle({ x: M, y: this.y - 20, width: W - 2 * M, height: 20, color: rgb(0.93, 0.9, 1), borderColor: rgb(0.5, 0.3, 0.8), borderWidth: 1 });
    this.page.drawText(clean(text), { x: M + 6, y: this.y - 14, size: 8.5, font: this.bold, color: rgb(0.3, 0.1, 0.5) });
    this.y -= 28;
    return this;
  }
  heading(text: string) {
    this.ensure(24);
    this.y -= 6;
    this.page.drawText(clean(text), { x: M, y: this.y - 11, size: 11, font: this.bold });
    this.y -= 18;
    return this;
  }
  kv(pairs: [string, string][]) {
    const colW = (W - 2 * M) / 2;
    for (let i = 0; i < pairs.length; i += 2) {
      this.ensure(14);
      pairs.slice(i, i + 2).forEach(([k, v], j) => {
        this.page.drawText(clean(`${k}: `), { x: M + j * colW, y: this.y - 9, size: 8.5, font: this.bold });
        this.page.drawText(clean(v).slice(0, 70), { x: M + j * colW + this.bold.widthOfTextAtSize(clean(`${k}: `), 8.5), y: this.y - 9, size: 8.5, font: this.font });
      });
      this.y -= 13;
    }
    return this;
  }
  paragraph(text: string | null | undefined, size = 9) {
    if (!text) return this;
    for (const para of text.split(/\n/)) {
      for (const line of this.wrap(para, size, W - 2 * M)) {
        this.ensure(size + 4);
        this.page.drawText(line, { x: M, y: this.y - size, size, font: this.font });
        this.y -= size + 3;
      }
      this.y -= 3;
    }
    return this;
  }
  table(headers: string[], rows: string[][], widths: number[], alignRight: boolean[] = []) {
    const total = widths.reduce((a, b) => a + b, 0);
    const ws = widths.map((w) => (w / total) * (W - 2 * M));
    const drawRow = (cells: string[], font: PDFFont, bg?: boolean) => {
      this.ensure(14);
      if (bg) this.page.drawRectangle({ x: M, y: this.y - 12, width: W - 2 * M, height: 13, color: rgb(0.93, 0.94, 0.96) });
      let x = M;
      cells.forEach((c, i) => {
        let t = clean(c);
        while (t.length > 1 && font.widthOfTextAtSize(t, 8) > ws[i] - 4) t = t.slice(0, -2) + "…";
        const tx = alignRight[i] ? x + ws[i] - 2 - font.widthOfTextAtSize(t, 8) : x + 2;
        this.page.drawText(t, { x: tx, y: this.y - 9, size: 8, font });
        x += ws[i];
      });
      this.y -= 13;
    };
    drawRow(headers, this.bold, true);
    for (const r of rows) drawRow(r, this.font);
    this.y -= 4;
    return this;
  }
  spacer(h = 8) {
    this.y -= h;
    return this;
  }
  async bytes() {
    return this.doc.save();
  }
}
