import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/next";
import { getProposal } from "@/modules/proposals/service";
import { PdfBuilder } from "@/server/pdf";
import { formatMoney, formatQty } from "@/lib/money";
import { formatCivil } from "@/lib/dates";
import { statusLabel } from "@/lib/labels";
import { audit } from "@/server/audit";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.permissions.has("crm.read")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const v = new URL(req.url).searchParams.get("v");
  const data = await getProposal(ctx, (await params).id, v ? Number(v) : undefined);
  if (!data) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
  const { p, v: ver, lines } = data;
  const [party, company, term, tpl] = await Promise.all([
    ctx.db.party.findFirst({ where: { id: p.partyId } }), ctx.db.company.findFirst({ where: { id: p.companyId } }),
    ver.paymentTermId ? ctx.db.paymentTerm.findFirst({ where: { id: ver.paymentTermId } }) : null, ctx.db.documentTemplate.findFirst({ where: { type: "PROPOSAL", active: true } }),
  ]);
  const pdf = await PdfBuilder.create(`${company?.legalName ?? ""} — Proposta ${p.number} v${ver.version} — documento comercial, sem valor fiscal.${tpl?.footer ? " " + tpl.footer : ""}`);
  pdf.title(`Proposta comercial ${p.number} — versão ${ver.version}`, `${company?.legalName ?? ""} · CNPJ ${company?.cnpj ?? ""}`);
  if (tpl?.header) pdf.paragraph(tpl.header);
  pdf.kv([["Cliente", party?.name ?? ""], ["Título", p.title], ["Modelo comercial", statusLabel(ver.commercialModel)], ["Situação", statusLabel(ver.status)], ["Início", formatCivil(ver.startDate)], ["Término", formatCivil(ver.endDate)], ["Validade", formatCivil(ver.validUntil)], ["Condição de pagamento", term?.name ?? "—"]]);
  for (const [h, t] of [["Escopo", ver.scope], ["Entregáveis", ver.deliverables], ["Premissas e restrições", ver.assumptions], ["Exclusões", ver.exclusions], ["Cronograma", ver.schedule]] as const) {
    if (t) pdf.heading(h).paragraph(t);
  }
  pdf.heading("Composição de preço");
  pdf.table(["Descrição", "Horas/Qtd.", "Preço unit.", "Valor"], lines.filter((l) => l.billable).map((l) => [l.description, l.kind === "LABOR" ? formatQty(l.hours) + " h" : formatQty(l.quantity), formatMoney(l.unitPrice), formatMoney(l.revenue)]), [5, 1.5, 1.5, 1.8], [false, true, true, true]);
  pdf.kv([["Valor bruto", formatMoney(ver.grossRevenue)], ["Desconto", formatMoney(ver.discountAmount)], ["Valor total", formatMoney(ver.netRevenue)], ["Horas estimadas", formatQty(ver.totalHours)]]);
  if (tpl?.body) pdf.spacer().paragraph(tpl.body);
  if (ver.acceptedAt) pdf.spacer().paragraph(`Aceite registrado em ${formatCivil(ver.acceptedAt)} por ${ver.acceptedByName}. ${ver.acceptanceNote ?? ""}`);
  await audit(ctx, { action: "proposal.pdf", entity: "Proposal", entityId: p.id, changes: { version: ver.version } });
  return new NextResponse(new Uint8Array(await pdf.bytes()), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${p.number}-v${ver.version}.pdf"` } });
}
