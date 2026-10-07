/**
 * Suprimentos de demonstração (via serviços): subcontratação do projeto de implantação com cotações, aceites parciais e
 * documento divergente; profissional PJ (custo apropriado via horas — o documento do PJ vai para "Pessoal", sem duplicar no projeto);
 * licenças/assinatura/equipamentos com controle de ativos; documentação de conformidade e avaliação de fornecedor.
 */
import { prisma } from "../src/server/db";
import type { DemoContext } from "./seed-demo";
import { createRequisition, submitRequisition, addQuotation, createPurchaseOrder, submitPurchaseOrder, postReceipt, registerSupplierInvoice, evaluateSupplier, addComplianceDoc, moveAsset } from "../src/modules/procurement/service";
import { decide } from "../src/modules/approvals/service";
import { addDays, addMonths, monthStart } from "../src/lib/dates";

const NONE = { lineKind: [], lineDescription: [], lineQuantity: [], linePrice: [] };

export async function seedProcurement(d: DemoContext) {
  const buyer = d.users.compras.ctx;
  const director = d.users.diretor.ctx;
  const T = d.today;
  const P = d.parties;
  const account = async (key: string) => (await prisma.managerialAccount.findFirstOrThrow({ where: { organizationId: d.orgId, systemKey: key } })).id;
  const approvePending = async (entityId: string) => {
    for (const ar of await prisma.approvalRequest.findMany({ where: { organizationId: d.orgId, entityId, status: "PENDING" } })) await decide(director, ar.id, true, "Aprovado conforme orçamento do projeto");
  };
  const line = async (poId: string, i = 0) => (await prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: poId }, orderBy: { id: "asc" } }))[i];
  const fixedProject = d.refs["project:fixed"];

  // 1) Subcontratação de integrações do projeto de implantação: requisição → 2 cotações → pedido → aceites → NFs
  const req = await createRequisition(buyer, { companyId: d.companies.main, projectId: fixedProject, accountId: await account("THIRD_PARTY_COST"), description: "Subcontratação de desenvolvimento de integrações", justification: "Escopo de integrações previsto na linha de base (custo de terceiros)", neededBy: monthStart(addMonths(T, -4)), lineKind: ["SERVICE"], lineDescription: ["Desenvolvimento de interfaces (horas)"], lineQuantity: ["350"], lineUnit: ["H"], linePrice: ["120"] });
  if (!(await submitRequisition(buyer, req.id))) await approvePending(req.id);
  const rl = await prisma.requisitionLine.findFirstOrThrow({ where: { requisitionId: req.id } });
  const qIntegra = await addQuotation(buyer, { requisitionId: req.id, supplierPartyId: P.Integra, deliveryDays: 20, paymentTerms: "30 dias após aceite", validUntil: addDays(T, 30), lineId: [rl.id], unitPrice: ["115"] });
  await addQuotation(buyer, { requisitionId: req.id, supplierPartyId: P.CarlosDev, deliveryDays: 10, paymentTerms: "15 dias", lineId: [rl.id], unitPrice: ["125"] });
  const poSub = await createPurchaseOrder(buyer, { companyId: d.companies.main, supplierPartyId: P.Integra, quotationId: qIntegra.id, kind: "SUBCONTRACT", orderDate: addMonths(T, -4), startDate: addMonths(T, -4), endDate: addMonths(T, 2), advanceAmount: "0", tolerancePct: "2", notes: "Subcontratação com aceite mensal por horas entregues", ...NONE });
  await submitPurchaseOrder(buyer, poSub.id);
  await approvePending(poSub.id);
  const ls = await line(poSub.id);
  await postReceipt(d.users.pmo.ctx, { purchaseOrderId: poSub.id, date: addMonths(T, -2), kind: "SERVICE_ACCEPTANCE", notes: "Aceite das interfaces de faturamento (relatório de horas anexado)", lineId: [ls.id], quantity: ["120"] });
  await registerSupplierInvoice(buyer, { purchaseOrderId: poSub.id, number: "INT-2026-0412", issueDate: addMonths(T, -2), dueDate: addDays(addMonths(T, -2), 30), competence: addMonths(T, -2), amount: "13800" });
  await postReceipt(d.users.pmo.ctx, { purchaseOrderId: poSub.id, date: addMonths(T, -1), kind: "SERVICE_ACCEPTANCE", notes: "Aceite das interfaces de estoque", lineId: [ls.id], quantity: ["100"] });
  // Documento acima do aceito (além da tolerância de 2%) → fica divergente para tratamento
  await registerSupplierInvoice(buyer, { purchaseOrderId: poSub.id, number: "INT-2026-0533", issueDate: addMonths(T, -1), dueDate: addDays(addMonths(T, -1), 30), competence: addMonths(T, -1), amount: "12000" });
  await evaluateSupplier(d.users.pmo.ctx, { partyId: P.Integra, purchaseOrderId: poSub.id, quality: 4, deadline: 3, price: 4, communication: 5, comment: "Boa qualidade técnica; atraso de uma semana na segunda entrega." });

  // 2) Profissional PJ (Carlos): pedido direto, apropriado em "Pessoal" — o custo chega ao projeto pelas horas apontadas
  const poPj = await createPurchaseOrder(buyer, { companyId: d.companies.main, supplierPartyId: P.CarlosDev, kind: "PJ_PROFESSIONAL", orderDate: monthStart(addMonths(T, -5)), startDate: monthStart(addMonths(T, -5)), endDate: addDays(monthStart(addMonths(T, 4)), -1), costCenterId: d.refs.ccOp, accountId: await account("PAYROLL"), advanceAmount: "0", tolerancePct: "0", notes: "Contratação PJ — horas aceitas conforme apontamentos aprovados", lineKind: ["PROFESSIONAL"], lineDescription: ["Horas de desenvolvimento (PJ)"], lineQuantity: ["1200"], linePrice: ["95"] });
  await submitPurchaseOrder(buyer, poPj.id);
  await approvePending(poPj.id);
  const lp = await line(poPj.id);
  for (const m of [-3, -2, -1]) {
    const month = monthStart(addMonths(T, m));
    await postReceipt(d.users.pmo.ctx, { purchaseOrderId: poPj.id, date: month, kind: "SERVICE_ACCEPTANCE", notes: "Horas do mês aprovadas no timesheet", lineId: [lp.id], quantity: ["126"] });
    await registerSupplierInvoice(buyer, { purchaseOrderId: poPj.id, number: `CD-${month.slice(0, 7)}`, issueDate: month, dueDate: addDays(month, 10), competence: month, amount: "11970" });
  }

  // 3) Licenças, assinatura e equipamentos (centro de custo administrativo) → ativos
  const poLic = await createPurchaseOrder(buyer, { companyId: d.companies.main, supplierPartyId: P.Nuvem, kind: "LICENSE", orderDate: addMonths(T, -3), startDate: addMonths(T, -3), endDate: addDays(T, 45), costCenterId: d.refs.ccAdm, accountId: await account("ADMIN_EXPENSES"), advanceAmount: "1000", tolerancePct: "0", lineKind: ["LICENSE", "SUBSCRIPTION", "EQUIPMENT"], lineDescription: ["Licenças de produtividade (anual)", "Ferramenta de gestão de chamados (assinatura)", "Notebook para consultores"], lineQuantity: ["20", "1", "2"], linePrice: ["60", "4800", "7500"] });
  await submitPurchaseOrder(buyer, poLic.id);
  await approvePending(poLic.id);
  const licLines = await prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: poLic.id } });
  await postReceipt(buyer, { purchaseOrderId: poLic.id, date: addMonths(T, -3), kind: "GOODS_RECEIPT", notes: "Licenças ativadas e notebooks entregues no escritório", lineId: licLines.map((l) => l.id), quantity: licLines.map((l) => l.quantity.toString()) });
  await registerSupplierInvoice(buyer, { purchaseOrderId: poLic.id, number: "NV-88812", issueDate: addMonths(T, -3), dueDate: addDays(addMonths(T, -3), 15), competence: addMonths(T, -3), amount: "20000" });
  const notebook = await prisma.asset.findFirstOrThrow({ where: { purchaseOrderId: poLic.id, kind: "EQUIPMENT" } });
  await moveAsset(buyer, { assetId: notebook.id, kind: "ASSIGN", professionalId: d.professionals["Diego"], notes: "Entregue para o projeto de implantação" });

  // 4) Requisição em cotação (hospedagem da equipe) — demonstra mapa comparativo em aberto
  const req2 = await createRequisition(buyer, { companyId: d.companies.main, projectId: fixedProject, accountId: await account("DIRECT_EXPENSES"), description: "Hospedagem da equipe para o go-live", neededBy: addDays(T, 20), lineKind: ["SERVICE"], lineDescription: ["Diárias de hotel"], lineQuantity: ["24"], lineUnit: ["DIA"], linePrice: ["380"] });
  if (!(await submitRequisition(buyer, req2.id))) await approvePending(req2.id);
  const rl2 = await prisma.requisitionLine.findFirstOrThrow({ where: { requisitionId: req2.id } });
  await addQuotation(buyer, { requisitionId: req2.id, supplierPartyId: P.Viagem, deliveryDays: 2, paymentTerms: "Faturado 28 dias", validUntil: addDays(T, 10), lineId: [rl2.id], unitPrice: ["355"] });

  // 5) Documentação de conformidade (uma vencendo, uma vencida)
  await addComplianceDoc(buyer, { partyId: P.Integra, docType: "Certidão negativa de débitos federais", validUntil: addDays(T, 20) });
  await addComplianceDoc(buyer, { partyId: P.Integra, docType: "Contrato social", notes: "Última alteração registrada" });
  await addComplianceDoc(buyer, { partyId: P.CarlosDev, docType: "Certidão negativa de débitos federais", validUntil: addDays(T, -5) });
  await addComplianceDoc(buyer, { partyId: P.Nuvem, docType: "Termo de confidencialidade", validUntil: addMonths(T, 12) });

  return { poSubcontract: poSub.id, poPj: poPj.id, poLicense: poLic.id };
}
