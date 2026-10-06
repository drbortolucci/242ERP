import { describe, expect, it } from "vitest";
import { newOrg, addUser } from "../helpers";
import { prisma } from "@/server/db";
import "@/modules/approvals/register-all";
import { createCompany } from "@/modules/companies/service";
import { createParty } from "@/modules/parties/service";
import { createLead, convertLead, crmMetrics, loseOpportunity, createActivity } from "@/modules/crm/service";
import { createProposal, saveDraft, submitProposal, registerAcceptance, newVersion, getProposal, type VersionInput } from "@/modules/proposals/service";
import { decide } from "@/modules/approvals/service";
import { createSalesOrderFromProposal, createContractFromOrder, activateContract, createAmendment, submitAmendment, contractAlerts, addContractRate, pickRate, updateContract, type ContractInput } from "@/modules/contracts/service";
import { createPriceTable, addPriceItem } from "@/modules/config/special";
import { saveConfig } from "@/modules/config/service";

const company = { kind: "HEADQUARTERS" as const, legalName: "Empresa Comercial Ltda", cnpj: "11222333000181", currency: "BRL", timezone: "America/Sao_Paulo" };

function version(lines: { kind: string; description: string; hours?: string; quantity?: string; unitPrice: string; unitCost: string; teamRoleId?: string; seniorityId?: string }[], extra: Partial<VersionInput> = {}): VersionInput {
  return {
    commercialModel: "TIME_MATERIAL", months: 1, discountPct: "0", taxRatePct: "10", validUntil: "2099-12-31",
    lineKind: lines.map((l) => l.kind), lineDescription: lines.map((l) => l.description), lineServiceId: lines.map(() => ""), lineTeamRoleId: lines.map((l) => l.teamRoleId ?? ""),
    lineSeniorityId: lines.map((l) => l.seniorityId ?? ""), lineHours: lines.map((l) => l.hours ?? "0"), lineQuantity: lines.map((l) => l.quantity ?? "1"),
    lineUnitPrice: lines.map((l) => l.unitPrice), lineUnitCost: lines.map((l) => l.unitCost), lineBillable: lines.map(() => "1"), ...extra,
  } as VersionInput;
}

const contractInput = (o: Partial<ContractInput> = {}): ContractInput => ({
  title: "Contrato T&M", commercialModel: "TIME_MATERIAL", startDate: "2026-01-01", endDate: "2026-12-31", totalValue: "30000", paymentTermId: undefined, billingDay: 1, billingFrequency: "MONTHLY",
  requiresClientTimesheetApproval: false, requiresClientMeasurementApproval: false, requiresPo: true, overagePolicy: "REQUIRE_APPROVAL", revenueMethod: "TIME_MATERIAL",
  lowBalancePct: 20, taxRatePct: "10", autoRenew: false, renewalNoticeDays: 60, ...o,
} as ContractInput);

describe("ciclo comercial: lead → oportunidade → proposta → aprovação → aceite → pedido → contrato", () => {
  it("executa o fluxo com alçadas, SoD, snapshot de tarifas e rastreabilidade", async () => {
    const { ctx, org } = await newOrg();
    const c = await createCompany(ctx, company);
    const seller = await addUser(org.id, ["sales"]);
    const director = await addUser(org.id, ["director"]);
    const role = await prisma.teamRole.findFirstOrThrow({ where: { organizationId: org.id, name: "Consultor funcional" } });
    const sen = await prisma.seniorityLevel.findFirstOrThrow({ where: { organizationId: org.id, name: "Sênior" } });
    await saveConfig(ctx, "comissoes", null, { name: "Comissão vendedor", basis: "BOOKING", ratePct: "3" });

    // Lead → conta + oportunidade
    const lead = await createLead(seller, { name: "Maria Cliente", companyName: "Cliente Novo S.A.", email: "maria@cliente.local", source: "Indicação" });
    const { party, opp } = await convertLead(seller, lead.id, { companyId: c.id, title: "Implantação financeira", estimatedValue: "30000" });
    expect(party.isProspect).toBe(true);
    await createActivity(seller, { type: "MEETING", subject: "Reunião de descoberta", opportunityId: opp.id, done: true });

    // Proposta com desconto acima da alçada → exige aprovação
    const p = await createProposal(seller, { companyId: c.id, partyId: party.id, title: "Proposta implantação", opportunityId: opp.id, commercialModel: "TIME_MATERIAL" });
    const totals = await saveDraft(seller, p.id, version([{ kind: "LABOR", description: "Consultor FI", hours: "150", unitPrice: "220", unitCost: "100", teamRoleId: role.id, seniorityId: sen.id }], { discountPct: "15" }));
    expect(totals.netRevenue.toFixed(2)).toBe("28050.00");
    const sub = await submitProposal(seller, p.id);
    expect(sub.approved).toBe(false);
    await expect(saveDraft(seller, p.id, version([]))).rejects.toThrow(/imutável|rascunho/);
    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: p.id, status: "PENDING" } });
    await expect(decide(seller, req.id, true)).rejects.toThrow();
    await decide(director, req.id, true, "Desconto estratégico");
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("APPROVED");

    // Aceite → oportunidade ganha, prospect vira cliente
    await registerAcceptance(seller, p.id, { acceptedByName: "Maria Cliente", note: "Aceite por e-mail" });
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).status).toBe("WON");
    expect((await prisma.party.findUniqueOrThrow({ where: { id: party.id } })).isCustomer).toBe(true);
    await expect(newVersion(seller, p.id)).rejects.toThrow(/aditivo/);

    // Pedido e contrato com snapshot de tarifas
    const so = await createSalesOrderFromProposal(seller, p.id, { orderDate: "2026-01-02", customerPo: "OC-123" });
    await expect(createSalesOrderFromProposal(seller, p.id, { orderDate: "2026-01-02" })).rejects.toThrow(/Já existe pedido/);
    const ct = await createContractFromOrder(seller, so.id, contractInput({ totalValue: "28050" }));
    const rates = await prisma.contractRate.findMany({ where: { contractId: ct.id } });
    expect(rates).toHaveLength(1);
    expect(rates[0].hourlyRate.toString()).toBe("220");
    // AC28: alteração posterior da tabela comercial não altera o contrato
    const table = await createPriceTable(ctx, { name: "Nova tabela", validFrom: "2026-01-01" });
    await addPriceItem(ctx, { priceTableId: table.id, teamRoleId: role.id, seniorityId: sen.id, hourlyRate: "999", referenceCost: "0" });
    expect((await prisma.contractRate.findFirstOrThrow({ where: { contractId: ct.id } })).hourlyRate.toString()).toBe("220");
    // Proposta aprovada preserva valores
    const view = await getProposal(seller, p.id);
    expect(view!.v.netRevenue.toString()).toBe("28050");

    await activateContract(seller, ct.id, { signedAt: "2026-01-03", signatureEvidence: "PDF assinado anexado" });
    const comm = await prisma.commissionEntry.findMany({ where: { contractId: ct.id } });
    expect(comm.map((x) => x.amount.toString())).toEqual(["841.5"]); // 3% de 28.050
    await expect(updateContract(seller, ct.id, contractInput({ totalValue: "99999" }))).rejects.toThrow(/aditivo/);

    // Reajuste com vigência
    await addContractRate(seller, { contractId: ct.id, teamRoleId: role.id, seniorityId: sen.id, hourlyRate: "235", validFrom: "2026-07-01", reason: "IPCA" });
    const allRates = await prisma.contractRate.findMany({ where: { contractId: ct.id } });
    const prof = { id: "x", teamRoleId: role.id, seniorityId: sen.id };
    expect(pickRate(allRates, "2026-06-30", prof)?.toString()).toBe("220");
    expect(pickRate(allRates, "2026-07-01", prof)?.toString()).toBe("235");

    // Aditivo exige aprovação contratual
    const a = await createAmendment(seller, { contractId: ct.id, description: "Ampliação de escopo", valueDelta: "5000", hoursDelta: "20" });
    await submitAmendment(seller, a.id);
    const areq = await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: a.id, status: "PENDING" } });
    await decide(director, areq.id, true);
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: ct.id } });
    expect(after.totalValue.toString()).toBe("33050");
    expect(after.version).toBe(2);

    // Rastreabilidade
    expect(after.salesOrderId).toBe(so.id);
    expect(after.opportunityId).toBe(opp.id);
    expect(after.proposalVersionId).toBe(so.proposalVersionId);
  });

  it("alerta falta de OC e calcula indicadores do funil", async () => {
    const { ctx } = await newOrg();
    const c = await createCompany(ctx, company);
    const party = await createParty(ctx, { personType: "COMPANY", name: "Cliente X", isCustomer: true, isProspect: false, isSupplier: false, isPartner: false });
    const { createContract } = await import("@/modules/contracts/service");
    const ct = await createContract(ctx, { ...contractInput({ requiresPo: true }), companyId: c.id, partyId: party.id });
    await activateContract(ctx, ct.id, {});
    const alerts = await contractAlerts(ctx);
    expect(alerts.some((a) => a.kind === "MISSING_PO")).toBe(true);

    const { createOpportunity } = await import("@/modules/crm/service");
    const base = { companyId: c.id, partyId: party.id, competitors: [], kind: "NEW" as const, serviceIds: [], itemModels: [], itemValues: [] };
    const o1 = await createOpportunity(ctx, { ...base, title: "Op 1", estimatedValue: "100000", probability: 50 });
    await createOpportunity(ctx, { ...base, title: "Op 2", estimatedValue: "40000", probability: 25 });
    const reason = await prisma.lossReason.findFirstOrThrow({ where: { organizationId: ctx.orgId } });
    await expect(loseOpportunity(ctx, o1.id, "")).rejects.toThrow(/motivo/);
    const m1 = await crmMetrics(ctx);
    expect(m1.pipelineGross.toFixed(2)).toBe("140000.00");
    expect(m1.pipelineWeighted.toFixed(2)).toBe("60000.00");
    await loseOpportunity(ctx, o1.id, reason.id, "Preço");
    const m2 = await crmMetrics(ctx);
    expect(m2.lostCount).toBe(1);
    expect(m2.conversionPct!.toString()).toBe("0");
  });
});
