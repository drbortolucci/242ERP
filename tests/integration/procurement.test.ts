import { describe, expect, it } from "vitest";
import { newOrg, addUser } from "../helpers";
import { prisma } from "@/server/db";
import "@/modules/approvals/register-all";
import { createCompany } from "@/modules/companies/service";
import { createParty } from "@/modules/parties/service";
import { decide } from "@/modules/approvals/service";
import { createRequisition, submitRequisition, addQuotation, createPurchaseOrder, submitPurchaseOrder, postReceipt, registerSupplierInvoice, acceptDivergence, cancelSupplierInvoice, cancelPurchaseOrder, openCommitments, budgetCheck } from "@/modules/procurement/service";
import { compareQuotations, threeWayMatch } from "@/domain/three-way-match";

const company = { kind: "HEADQUARTERS" as const, legalName: "Empresa Compras Ltda", cnpj: "11222333000181", currency: "BRL", timezone: "America/Sao_Paulo" };

describe("conferência de 3 vias e comparação de cotações (domínio)", () => {
  it("aceita dentro do recebido e recusa acima", () => {
    expect(threeWayMatch({ poTotal: 1000, received: 600, alreadyInvoiced: 0, invoiceAmount: 600, tolerancePct: 0 }).ok).toBe(true);
    const m = threeWayMatch({ poTotal: 1000, received: 600, alreadyInvoiced: 0, invoiceAmount: 650, tolerancePct: 0 });
    expect(m.ok).toBe(false);
    expect(threeWayMatch({ poTotal: 1000, received: 600, alreadyInvoiced: 0, invoiceAmount: 650, tolerancePct: 10 }).ok).toBe(true);
    expect(threeWayMatch({ poTotal: 1000, received: 0, alreadyInvoiced: 0, invoiceAmount: 10, tolerancePct: 0 }).divergences[0]).toMatch(/Não há recebimento/);
  });
  it("identifica melhor preço total, prazo e por item", () => {
    const r = compareQuotations([{ id: "a", total: 1000, deliveryDays: 10, lines: [{ lineId: "x", unitPrice: 5 }, { lineId: "y", unitPrice: 10 }] }, { id: "b", total: 900, deliveryDays: 20, lines: [{ lineId: "x", unitPrice: 6 }, { lineId: "y", unitPrice: 7 }] }]);
    expect(r).toEqual({ cheapestId: "b", fastestId: "a", bestByLine: { x: "a", y: "b" } });
  });
});

describe("ciclo de compra de serviço até conta a pagar", () => {
  it("requisição → cotações → pedido aprovado (SoD) → aceite parcial → NF conferida → conta a pagar; divergência e duplicidade", async () => {
    const { ctx, org } = await newOrg();
    const c = await createCompany(ctx, company);
    const cc = await prisma.costCenter.create({ data: { organizationId: org.id, companyId: c.id, code: "100", name: "Delivery" } });
    const s1 = await createParty(ctx, { personType: "COMPANY", name: "Fornecedor A", document: "11444777000161", isSupplier: true, isCustomer: false, isProspect: false, isPartner: false });
    const s2 = await createParty(ctx, { personType: "COMPANY", name: "Fornecedor B", isSupplier: true, isCustomer: false, isProspect: false, isPartner: false });
    const buyer = await addUser(org.id, ["purchasing"]);
    const approver = await addUser(org.id, ["director"]);

    const req = await createRequisition(buyer, { companyId: c.id, costCenterId: cc.id, description: "Subcontratação de integração", lineKind: ["SERVICE"], lineDescription: ["Desenvolvimento de interfaces"], lineQuantity: ["100"], lineUnit: ["H"], linePrice: ["120"] });
    expect(req.estimatedAmount.toString()).toBe("12000");
    expect((req.budgetCheck as { hasBudget: boolean }).hasBudget).toBe(false);
    await submitRequisition(buyer, req.id);
    const line = await prisma.requisitionLine.findFirstOrThrow({ where: { requisitionId: req.id } });
    const qa = await addQuotation(buyer, { requisitionId: req.id, supplierPartyId: s1.id, deliveryDays: 15, lineId: [line.id], unitPrice: ["110"] });
    await addQuotation(buyer, { requisitionId: req.id, supplierPartyId: s2.id, deliveryDays: 10, lineId: [line.id], unitPrice: ["130"] });
    await expect(addQuotation(buyer, { requisitionId: req.id, supplierPartyId: s1.id, lineId: [line.id], unitPrice: ["100"] })).rejects.toThrow(/já cotou/);

    const po = await createPurchaseOrder(buyer, { companyId: c.id, supplierPartyId: s1.id, quotationId: qa.id, kind: "SUBCONTRACT", orderDate: "2026-09-01", advanceAmount: "0", tolerancePct: "0", lineKind: [], lineDescription: [], lineQuantity: [], linePrice: [] });
    expect(po.totalAmount.toString()).toBe("11000");
    await expect(createPurchaseOrder(buyer, { companyId: c.id, supplierPartyId: s1.id, quotationId: qa.id, orderDate: "2026-09-01", kind: "ONE_OFF", advanceAmount: "0", tolerancePct: "0", lineKind: [], lineDescription: [], lineQuantity: [], linePrice: [] })).rejects.toThrow(/já possui pedido/);
    const sub = await submitPurchaseOrder(buyer, po.id);
    expect(sub.approved).toBe(false);
    const ar = await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: po.id, status: "PENDING" } });
    await expect(decide(buyer, ar.id, true)).rejects.toThrow();
    await decide(approver, ar.id, true);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("APPROVED");
    expect((await openCommitments(ctx)).find((x) => x.po.id === po.id)?.open.toString()).toBe("11000");

    // NF sem aceite → divergente
    const div = await registerSupplierInvoice(buyer, { purchaseOrderId: po.id, number: "NF-1", issueDate: "2026-09-10", dueDate: "2026-10-10", competence: "2026-09-10", amount: "5500" });
    expect(div.match.ok).toBe(false);
    await cancelSupplierInvoice(buyer, div.invoice.id, "Recebida antes do aceite");
    // Aceite parcial (50h)
    const pol = await prisma.purchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: po.id } });
    await expect(postReceipt(buyer, { purchaseOrderId: po.id, date: "2026-09-15", kind: "SERVICE_ACCEPTANCE", lineId: [pol.id], quantity: ["150"] })).rejects.toThrow(/acima do saldo/);
    await postReceipt(buyer, { purchaseOrderId: po.id, date: "2026-09-15", kind: "SERVICE_ACCEPTANCE", lineId: [pol.id], quantity: ["50"] });
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("PARTIALLY_RECEIVED");
    // NF conferida → conta a pagar aguardando aprovação financeira
    const ok = await registerSupplierInvoice(buyer, { purchaseOrderId: po.id, number: "NF-2", issueDate: "2026-09-20", dueDate: "2026-10-20", competence: "2026-09-20", amount: "5500" });
    expect(ok.match.ok).toBe(true);
    const pay = await prisma.payable.findFirstOrThrow({ where: { sourceType: "SUPPLIER_INVOICE", sourceId: ok.invoice.id } });
    expect(pay.status).toBe("PENDING_APPROVAL");
    expect(pay.amount.toString()).toBe("5500");
    await expect(registerSupplierInvoice(buyer, { purchaseOrderId: po.id, number: "NF-2", issueDate: "2026-09-20", dueDate: "2026-10-20", competence: "2026-09-20", amount: "1" })).rejects.toThrow(/duplicado/);
    // NF acima do aceito → divergência; aceite exige alçada e não pode ser de quem emitiu o pedido
    const d2 = await registerSupplierInvoice(buyer, { purchaseOrderId: po.id, number: "NF-3", issueDate: "2026-09-25", dueDate: "2026-10-25", competence: "2026-09-25", amount: "100" });
    expect(d2.match.ok).toBe(false);
    await expect(acceptDivergence(buyer, d2.invoice.id, "x")).rejects.toThrow();
    await acceptDivergence(approver, d2.invoice.id, "Hora extra autorizada pelo gestor");
    expect((await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: d2.invoice.id } })).status).toBe("APPROVED");
    expect((await openCommitments(ctx)).find((x) => x.po.id === po.id)?.open.toString()).toBe("5400");
    await expect(cancelPurchaseOrder(buyer, po.id, "teste")).rejects.toThrow(/não pode ser cancelado/);
  });

  it("verifica orçamento do projeto pela linha de base de terceiros", async () => {
    const { ctx } = await newOrg();
    const c = await createCompany(ctx, company);
    const party = await createParty(ctx, { personType: "COMPANY", name: "Cliente", isCustomer: true, isProspect: false, isSupplier: false, isPartner: false });
    const { createProject } = await import("@/modules/projects/service");
    const p = await createProject(ctx, { companyId: c.id, name: "P", partyId: party.id, plannedStart: "2026-01-01", plannedEnd: "2026-03-31", progressMethod: "HOURS", effortHours: "100", revenue: "50000", laborCost: "10000", thirdPartyCost: "8000", expenseCost: "0", applyTemplate: false });
    const ok = await budgetCheck(ctx, { projectId: p.id, companyId: c.id, amount: "7000" });
    expect(ok.ok).toBe(true);
    const over = await budgetCheck(ctx, { projectId: p.id, companyId: c.id, amount: "9000" });
    expect(over.ok).toBe(false);
    expect(over.available).toBe("8000.00");
  });

  it("apropria compras no projeto sem duplicar: terceiros pela NF aprovada, PJ pelas horas, encerrado libera compromisso", async () => {
    const { ctx, org } = await newOrg();
    const c = await createCompany(ctx, company);
    const party = await createParty(ctx, { personType: "COMPANY", name: "Cliente", isCustomer: true, isProspect: false, isSupplier: false, isPartner: false });
    const sup = await createParty(ctx, { personType: "COMPANY", name: "Subcontratada", isSupplier: true, isCustomer: false, isProspect: false, isPartner: false });
    const pj = await createParty(ctx, { personType: "COMPANY", name: "PJ Dev ME", isSupplier: true, isCustomer: false, isProspect: false, isPartner: false });
    const approver = await addUser(org.id, ["director"]);
    const { createProject } = await import("@/modules/projects/service");
    const { projectAnalytics } = await import("@/modules/projects/analytics");
    const p = await createProject(ctx, { companyId: c.id, name: "P", partyId: party.id, plannedStart: "2026-01-01", plannedEnd: "2026-12-31", progressMethod: "HOURS", effortHours: "100", revenue: "90000", laborCost: "10000", thirdPartyCost: "30000", expenseCost: "0", applyTemplate: false });
    const mk = async (supplierPartyId: string, kind: "SUBCONTRACT" | "PJ_PROFESSIONAL", total: string) => {
      const po = await createPurchaseOrder(ctx, { companyId: c.id, supplierPartyId, projectId: p.id, kind, orderDate: "2026-09-01", advanceAmount: "0", tolerancePct: "0", lineKind: ["SERVICE"], lineDescription: ["Serviço"], lineQuantity: ["1"], linePrice: [total] });
      await submitPurchaseOrder(ctx, po.id);
      const ar = await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: po.id, status: "PENDING" } });
      await decide(approver, ar.id, true);
      return po;
    };
    const sub = await mk(sup.id, "SUBCONTRACT", "10000");
    const other = await mk(sup.id, "SUBCONTRACT", "5000");
    const pjPo = await mk(pj.id, "PJ_PROFESSIONAL", "8000");
    for (const [po, amount, nf] of [[sub, "4000", "S-1"], [pjPo, "8000", "PJ-1"]] as const) {
      const l = await prisma.purchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: po.id } });
      await postReceipt(ctx, { purchaseOrderId: po.id, date: "2026-09-10", kind: "SERVICE_ACCEPTANCE", lineId: [l.id], quantity: [po === sub ? "0.4" : "1"] });
      expect((await registerSupplierInvoice(ctx, { purchaseOrderId: po.id, number: nf, issueDate: "2026-09-15", dueDate: "2026-10-15", competence: "2026-09-15", amount })).match.ok).toBe(true);
    }
    const { closePurchaseOrder } = await import("@/modules/procurement/service");
    await closePurchaseOrder(ctx, other.id, "Escopo absorvido pela equipe interna");
    const a = (await projectAnalytics(ctx, p.id))!;
    expect(a.thirdPartyCost.toString()).toBe("4000"); // só a NF aprovada da subcontratação; PJ fica fora (custo via horas)
    expect(a.committedNotRealized.toString()).toBe("6000"); // 10000 − 4000; pedido encerrado e PJ não comprometem
    expect(a.actualCost.toString()).toBe("4000");
  });
});
