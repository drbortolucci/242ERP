import { describe, expect, it } from "vitest";
import { newOrg, addUser } from "../helpers";
import { prisma } from "@/server/db";
import "@/modules/approvals/register-all";
import { createCompany } from "@/modules/companies/service";
import { createParty } from "@/modules/parties/service";
import { createContract, addContractRate, type ContractInput } from "@/modules/contracts/service";
import { createProfessional, addCostRate } from "@/modules/professionals/service";
import { createProject, setTaskStatus, addDependency, closeOperational, closeFinancial, reviseBaseline } from "@/modules/projects/service";
import { createAllocation, confirmAllocation, capacityGrid } from "@/modules/resources/service";
import { createTimeEntry, submitEntries, approveEntries, rejectEntries, clientDecision, createAdjustment, billingBlockReason } from "@/modules/timesheet/service";
import { createExpense, submitExpense } from "@/modules/expenses/service";
import { uploadAttachment } from "@/modules/attachments/service";
import { decide } from "@/modules/approvals/service";
import { buildCtx } from "@/server/context";
import { setSetting } from "@/server/settings";

const company = { kind: "HEADQUARTERS" as const, legalName: "Empresa Op Ltda", cnpj: "11222333000181", currency: "BRL", timezone: "America/Sao_Paulo" };
const contractBase = (o: Partial<ContractInput>): ContractInput => ({ title: "T&M", commercialModel: "TIME_MATERIAL", startDate: "2026-01-01", endDate: "2026-12-31", totalValue: "100000", billingDay: 1, billingFrequency: "MONTHLY", requiresClientTimesheetApproval: true, requiresClientMeasurementApproval: false, requiresPo: false, overagePolicy: "REQUIRE_APPROVAL", revenueMethod: "TIME_MATERIAL", lowBalancePct: 20, taxRatePct: "0", autoRenew: false, renewalNoticeDays: 60, ...o } as ContractInput);
const profBase = { employmentType: "CLT" as const, capacityPct: "100", certifications: [], skillIds: [] };

async function setup() {
  const o = await newOrg();
  const c = await createCompany(o.ctx, company);
  await setSetting(o.ctx, "timesheet", { lockAfterDays: 365 });
  const party = await createParty(o.ctx, { personType: "COMPANY", name: "Cliente Op", isCustomer: true, isProspect: false, isSupplier: false, isPartner: false });
  const ct = await createContract(o.ctx, { ...contractBase({}), companyId: c.id, partyId: party.id });
  await prisma.contract.update({ where: { id: ct.id }, data: { status: "ACTIVE" } });
  const role = await prisma.teamRole.findFirstOrThrow({ where: { organizationId: o.org.id, name: "Consultor funcional" } });
  const prof = await createProfessional(o.ctx, { ...profBase, companyId: c.id, name: "Ana Consultora", email: `ana-${o.org.id}@x.local`, teamRoleId: role.id });
  await addCostRate(o.ctx, { professionalId: prof.id, hourlyCost: "100", validFrom: "2026-01-01" });
  await addContractRate(o.ctx, { contractId: ct.id, teamRoleId: role.id, hourlyRate: "250", validFrom: "2026-01-01" });
  const type = await prisma.projectType.findFirstOrThrow({ where: { organizationId: o.org.id, templateKey: "ERP_IMPLEMENTATION" } });
  const proj = await createProject(o.ctx, { companyId: c.id, name: "Projeto Op", partyId: party.id, contractId: ct.id, projectTypeId: type.id, plannedStart: "2026-01-05", plannedEnd: "2026-06-30", progressMethod: "HOURS", effortHours: "1000", revenue: "100000", laborCost: "40000", thirdPartyCost: "0", expenseCost: "5000", applyTemplate: true });
  const consultant = await addUser(o.org.id, ["consultant"], { professionalId: prof.id });
  const pmo = await addUser(o.org.id, ["pmo", "resource_manager"]);
  return { ...o, c, party, ct, prof, proj, consultant, pmo, role };
}

describe("projetos, recursos, horas e despesas", () => {
  it("cria projeto com WBS do modelo, linha de base versionada e dependências sem ciclo", async () => {
    const s = await setup();
    const tasks = await prisma.projectTask.findMany({ where: { projectId: s.proj.id } });
    expect(tasks.filter((t) => t.kind === "PHASE")).toHaveLength(5);
    expect(tasks.filter((t) => t.requiresAcceptance).length).toBeGreaterThan(0);
    const months = await prisma.baselineMonth.findMany({ where: { baselineId: (await prisma.projectBaseline.findFirstOrThrow({ where: { projectId: s.proj.id } })).id } });
    expect(months).toHaveLength(6);
    expect(months.reduce((a, m) => a + Number(m.laborCost), 0)).toBe(40000);
    const [t1, t2] = tasks.filter((t) => t.kind !== "PHASE").slice(0, 2);
    await addDependency(s.pmo, t1.id, t2.id);
    await expect(addDependency(s.pmo, t2.id, t1.id)).rejects.toThrow(/ciclo/);
    await expect(setTaskStatus(s.pmo, t2.id, "DONE")).rejects.toThrow(/predecessoras/);
    await reviseBaseline(s.ctx, { projectId: s.proj.id, label: "Revisão 1", reason: "Aditivo", plannedStart: "2026-01-05", plannedEnd: "2026-07-31", effortHours: "1100", revenue: "110000", laborCost: "44000", thirdPartyCost: "0", expenseCost: "5000" });
    expect(await prisma.projectBaseline.count({ where: { projectId: s.proj.id } })).toBe(2);
  });

  it("detecta conflito de alocação e exige autorização com justificativa", async () => {
    const s = await setup();
    const base = { professionalId: s.prof.id, projectId: s.proj.id, startDate: "2026-03-02", endDate: "2026-03-06", billable: true };
    const a1 = await createAllocation(s.pmo, { ...base, mode: "PERCENT", value: "70", status: "CONFIRMED" });
    expect(a1.allocation.totalHours.toString()).toBe("28");
    const tentative = await createAllocation(s.pmo, { ...base, mode: "HOURS_PER_DAY", value: "4", status: "TENTATIVE" });
    expect(tentative.conflicts.length).toBe(5);
    const onlyResources = await addUser(s.org.id, ["pmo"]);
    await expect(createAllocation(onlyResources, { ...base, mode: "HOURS_PER_DAY", value: "4", status: "CONFIRMED" })).rejects.toThrow(/Conflito/);
    await expect(confirmAllocation(s.pmo, tentative.allocation.id)).rejects.toThrow(/Justifique/);
    await confirmAllocation(s.pmo, tentative.allocation.id, "Entrega crítica aprovada pela diretoria");
    expect((await prisma.auditLog.findFirst({ where: { organizationId: s.org.id, action: "allocation.confirm_override" } }))?.reason).toContain("crítica");
    const g = await capacityGrid(s.pmo, [s.prof.id], "2026-03-02", "2026-03-06");
    expect(g.rows[0].capacity.toString()).toBe("40");
    expect(g.rows[0].allocated.toString()).toBe("48");
  });

  it("fluxo de horas: rascunho → envio → aprovação interna → cliente → elegível, com snapshots e ajuste", async () => {
    const s = await setup();
    const e = await createTimeEntry(s.consultant, { date: "2026-03-02", hours: "8", description: "Configuração FI", activityType: "WORK", billable: true, projectId: s.proj.id });
    await expect(createTimeEntry(s.consultant, { date: "2026-03-02", hours: "8", description: "Configuração FI", activityType: "WORK", billable: true, projectId: s.proj.id })).rejects.toThrow(/duplicado|excede/);
    await expect(createTimeEntry(s.consultant, { date: "2026-03-02", hours: "6", description: "Outra", activityType: "WORK", billable: true, projectId: s.proj.id })).rejects.toThrow(/excede/);
    await submitEntries(s.consultant, [e.id]);
    await expect(approveEntries(s.consultant, [e.id])).rejects.toThrow(/time.approve/);
    await approveEntries(s.pmo, [e.id]);
    let row = await prisma.timeEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.costRate?.toString()).toBe("100");
    expect(row.costAmount?.toString()).toBe("800");
    expect(row.sellRate?.toString()).toBe("250");
    expect(row.clientApproval).toBe("PENDING");
    expect(row.billingStatus).toBe("BLOCKED");
    expect(billingBlockReason(row)?.reason).toMatch(/cliente/);
    // Custo alterado depois não muda o snapshot
    await addCostRate(s.ctx, { professionalId: s.prof.id, hourlyCost: "150", validFrom: "2026-04-01" });
    await clientDecision(s.pmo, [e.id], true, "Gerente do cliente (e-mail)");
    row = await prisma.timeEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.billingStatus).toBe("ELIGIBLE");
    expect(row.costRate?.toString()).toBe("100");
    // Rejeição exige motivo e volta para correção
    const e2 = await createTimeEntry(s.consultant, { date: "2026-03-03", hours: "4", description: "Reunião", activityType: "MEETING", billable: true, projectId: s.proj.id });
    await submitEntries(s.consultant, [e2.id]);
    await expect(rejectEntries(s.pmo, [e2.id], "")).rejects.toThrow(/motivo/);
    await rejectEntries(s.pmo, [e2.id], "Detalhar entregável");
    expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: e2.id } })).status).toBe("REJECTED");
    // Ajuste rastreável após faturamento
    await prisma.timeEntry.update({ where: { id: e.id }, data: { billingStatus: "INVOICED" } });
    const adj = await createAdjustment(s.pmo, e.id, "-2", "Horas lançadas a maior");
    expect(adj.adjustsEntryId).toBe(e.id);
    expect(adj.hours.toString()).toBe("-2");
    expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: e.id } })).hours.toString()).toBe("8");
  });

  it("segregação: consultor não aprova as próprias horas mesmo com permissão", async () => {
    const s = await setup();
    const both = await addUser(s.org.id, ["consultant", "pmo"], { professionalId: s.prof.id });
    const e = await createTimeEntry(both, { date: "2026-03-04", hours: "2", description: "Teste SoD", activityType: "WORK", billable: true, projectId: s.proj.id });
    await submitEntries(both, [e.id]);
    await expect(approveEntries(both, [e.id])).rejects.toThrow(/próprias horas/);
  });

  it("despesa reembolsável: separa custo, devido ao profissional e cobrável; aprovação gera conta a pagar", async () => {
    const s = await setup();
    await prisma.approvalRule.updateMany({ where: { organizationId: s.org.id, docType: "EXPENSE" }, data: { requiredPermission: "expense.approve" } });
    const cat = await prisma.expenseCategory.findFirstOrThrow({ where: { organizationId: s.org.id, name: "Hospedagem" } });
    const exp = await createExpense(s.consultant, { date: "2026-03-05", categoryId: cat.id, description: "Hotel visita cliente", amount: "450.00", paidBy: "PROFESSIONAL", billableToClient: true, billableAmount: "", projectId: s.proj.id });
    expect(exp.amount.toString()).toBe("450");
    expect(exp.reimbursableToProfessional.toString()).toBe("450");
    expect(exp.billableAmount.toString()).toBe("450");
    await expect(submitExpense(s.consultant, exp.id)).rejects.toThrow(/comprovante/);
    await uploadAttachment(s.ctx, { entity: "Expense", entityId: exp.id, fileName: "nota.pdf", data: Buffer.from("%PDF-1.4 recibo") });
    await submitExpense(s.consultant, exp.id);
    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: exp.id, status: "PENDING" } });
    await decide(s.pmo, req.id, true);
    const after = await prisma.expense.findUniqueOrThrow({ where: { id: exp.id } });
    expect(after.status).toBe("APPROVED");
    expect(after.billingStatus).toBe("ELIGIBLE");
    const pay = await prisma.payable.findUniqueOrThrow({ where: { id: after.payableId! } });
    expect(pay.amount.toString()).toBe("450");
    expect(pay.sourceType).toBe("EXPENSE_REIMBURSEMENT");
  });

  it("período fechado bloqueia apontamentos e encerramentos são separados", async () => {
    const s = await setup();
    await prisma.accountingPeriod.create({ data: { organizationId: s.org.id, companyId: s.c.id, month: new Date("2026-02-01"), status: "CLOSED" } });
    await expect(createTimeEntry(s.consultant, { date: "2026-02-10", hours: "2", description: "Fora do prazo", activityType: "WORK", billable: true, projectId: s.proj.id })).rejects.toThrow(/período 02\/2026 está fechado/);
    await expect(closeFinancial(s.ctx, s.proj.id)).rejects.toThrow(/Encerre a operação/);
    await expect(closeOperational(s.ctx, s.proj.id)).rejects.toThrow(/justificativa/);
    await closeOperational(s.ctx, s.proj.id, "Escopo remanescente transferido para AMS");
    await closeFinancial(await buildCtx(s.ctx.userId, s.org.id), s.proj.id);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: s.proj.id } })).financialStatus).toBe("CLOSED");
  });
});
