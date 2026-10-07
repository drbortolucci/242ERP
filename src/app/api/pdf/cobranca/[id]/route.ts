import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/next";
import { PdfBuilder } from "@/server/pdf";
import { formatMoney, formatQty } from "@/lib/money";
import { formatCivil } from "@/lib/dates";
import { audit } from "@/server/audit";

/** Documento interno de cobrança (demonstrativo) — NÃO é nota fiscal. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const client = ctx.kind === "CLIENT";
  if (client ? !ctx.permissions.has("portal.access") || !ctx.partyId : !ctx.permissions.has("billing.read")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  // cliente só acessa documentos da própria parte
  const d = await ctx.db.billingDocument.findFirst({ where: { id: (await params).id, ...(client ? { partyId: ctx.partyId!, status: "ISSUED" } : {}) } });
  if (!d) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  const [company, party, items, recs] = await Promise.all([ctx.db.company.findFirst({ where: { id: d.companyId } }), ctx.db.party.findFirst({ where: { id: d.partyId } }), ctx.db.measurementItem.findMany({ where: { billingDocumentId: d.id } }), ctx.db.receivable.findMany({ where: { billingDocumentId: d.id }, orderBy: { installment: "asc" } })]);
  const pdf = await PdfBuilder.create(`${company?.legalName ?? ""} — Documento de cobrança ${d.number} — DOCUMENTO INTERNO, NÃO É NOTA FISCAL.`);
  pdf.title(`Documento de cobrança ${d.number}`, `${company?.legalName ?? ""} · CNPJ ${company?.cnpj ?? ""} — demonstrativo interno, sem valor fiscal`);
  pdf.kv([["Cliente", party?.name ?? ""], ["Emissão", formatCivil(d.issueDate)], ["Competência", formatCivil(d.competence).slice(3)], ["OC do cliente", d.customerPo ?? "—"], ["Situação", d.status === "CANCELED" ? "CANCELADO" : "Emitido"]]);
  pdf.heading("Itens");
  pdf.table(["Descrição", "Qtd.", "Unitário", "Valor"], items.map((i) => [i.description, formatQty(i.quantity), formatMoney(i.unitPrice), formatMoney(i.amount)]), [5, 1, 1.6, 1.6], [false, true, true, true]);
  const wh = d.withholdings as { name: string; amount: string }[];
  pdf.kv([["Valor bruto", formatMoney(d.grossAmount)], ["Desconto", formatMoney(d.discountAmount)], ...wh.map((w) => [`Retenção — ${w.name}`, formatMoney(w.amount)] as [string, string]), ["Líquido a receber", formatMoney(d.netAmount)]]);
  pdf.heading("Vencimentos");
  pdf.table(["Título", "Parcela", "Vencimento", "Valor"], recs.map((r) => [r.number, `${r.installment}/${r.installments}`, formatCivil(r.dueDate), formatMoney(r.amount)]), [2, 1, 1.6, 1.6], [false, false, false, true]);
  await audit(ctx, { action: "billing.pdf", entity: "BillingDocument", entityId: d.id });
  return new NextResponse(new Uint8Array(await pdf.bytes()), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${d.number}.pdf"` } });
}
