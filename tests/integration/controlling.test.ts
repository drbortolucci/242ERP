import { describe, expect, it } from "vitest";
import { newOrg, addUser } from "../helpers";
import { prisma } from "@/server/db";
import "@/modules/approvals/register-all";
import { createCompany } from "@/modules/companies/service";
import { createParty } from "@/modules/parties/service";
import { syncLedger } from "@/modules/controlling/ledger";
import { dre, importPayroll, saveAllocationRule, runAllocation, reverseAllocation, closePeriod, reopenPeriod, projectPl, createBudget, setBudgetLines, approveBudget, budgetVsActual, closingChecklist } from "@/modules/controlling/service";
import { createManualTitle } from "@/modules/finance/service";
import { dec, sum } from "@/lib/money";

const company = { kind: "HEADQUARTERS" as const, legalName: "Consultoria Controle Ltda", cnpj: "11222333000181", currency: "BRL", timezone: "America/Sao_Paulo" };
const SEP = "2026-09-01";

async function setup() {
  const o = await newOrg();
  const c = await createCompany(o.ctx, company);
  const party = await createParty(o.ctx, { personType: "COMPANY", name: "Cliente C", isCustomer: true, isProspect: false, isSupplier: false, isPartner: false });
  const sup = await createParty(o.ctx, { personType: "COMPANY", name: "Fornecedor F", isCustomer: false, isProspect: false, isSupplier: true, isPartner: false });
  const cc = await prisma.costCenter.create({ data: { organizationId: o.org.id, companyId: c.id, code: "100", name: "Delivery" } });
  const ccAdm = await prisma.costCenter.create({ data: { organizationId: o.org.id, companyId: c.id, code: "900", name: "Administrativo", kind: "ADMINISTRATIVE" } });
  const contract = await prisma.contract.create({ data: { organizationId: o.org.id, companyId: c.id, number: "CTR-C1", partyId: party.id, title: "T&M", commercialModel: "TIME_MATERIAL", status: "ACTIVE", startDate: new Date("2026-01-01"), totalValue: 100000, taxRatePct: 10, revenueMethod: "TIME_MATERIAL" } });
  const project = await prisma.project.create({ data: { organizationId: o.org.id, companyId: c.id, code: "PRJ-C1", name: "Projeto C", partyId: party.id, contractId: contract.id, costCenterId: cc.id, status: "ACTIVE" } });
  await prisma.projectBaseline.create({ data: { organizationId: o.org.id, projectId: project.id, version: 1, label: "Original", effortHours: 100, revenue: 20000, laborCost: 10000, thirdPartyCost: 1000, expenseCost: 0 } });
  const prof = await prisma.professional.create({ data: { organizationId: o.org.id, companyId: c.id, name: "Analista", employmentType: "CLT", certifications: [], costCenterId: cc.id } });
  for (const d of ["2026-09-02", "2026-09-03"]) await prisma.timeEntry.create({ data: { organizationId: o.org.id, companyId: c.id, professionalId: prof.id, contractId: contract.id, projectId: project.id, date: new Date(d), hours: 10, description: "Trabalho", status: "APPROVED", billingStatus: "INVOICED", costRate: 100, costAmount: 1000, sellRate: 150, createdById: o.user.id } });
  const m = await prisma.measurement.create({ data: { organizationId: o.org.id, companyId: c.id, number: "MED-C1", partyId: party.id, contractId: contract.id, periodStart: new Date(SEP), periodEnd: new Date("2026-09-30"), competence: new Date(SEP), status: "INVOICED", totalAmount: 3000, createdById: o.user.id } });
  await prisma.measurementItem.create({ data: { organizationId: o.org.id, measurementId: m.id, sourceType: "TIME_ENTRY", description: "Horas", quantity: 20, unitPrice: 150, amount: 3000, projectId: project.id, status: "INVOICED" } });
  const po = await prisma.purchaseOrder.create({ data: { organizationId: o.org.id, companyId: c.id, number: "PC-C1", supplierPartyId: sup.id, projectId: project.id, kind: "SUBCONTRACT", status: "RECEIVED", orderDate: new Date(SEP), totalAmount: 500, createdById: o.user.id } });
  const inv = await prisma.supplierInvoice.create({ data: { organizationId: o.org.id, companyId: c.id, supplierPartyId: sup.id, purchaseOrderId: po.id, number: "NF-C1", issueDate: new Date(SEP), dueDate: new Date("2026-10-01"), competence: new Date(SEP), amount: 500, status: "APPROVED", createdById: o.user.id } });
  const controller = await addUser(o.org.id, ["controller"]);
  return { ...o, c, cc, ccAdm, contract, project, inv, controller };
}
const total = async (orgId: string) => dec((await prisma.managerialEntry.aggregate({ where: { organizationId: orgId }, _sum: { amount: true } }))._sum.amount ?? 0);

describe("razão gerencial, DRE e P&L", () => {
  it("lança custos com absorção sem duplicar, receita com dedução, terceiros; é idempotente e estorna origem cancelada; DRE e P&L", async () => {
    const { ctx, org, c, project, inv, controller } = await setup();
    expect((await syncLedger(controller, c.id, SEP)).posted).toBe(7); // 2 horas + 2 absorções + receita + dedução + NF
    expect((await syncLedger(controller, c.id, SEP)).posted).toBe(0); // idempotente
    const byKey = async (k: string) => (await prisma.managerialEntry.findMany({ where: { organizationId: org.id, dedupeKey: { startsWith: k } } })).map((e) => Number(e.amount));
    expect(await byKey("TIME:")).toEqual([1000, 1000]);
    expect(await byKey("ABSORB:")).toEqual([-1000, -1000]);
    expect(await byKey("DED:")).toEqual([300]);
    // documento de fornecedor cancelado → estorno vinculado na competência
    await prisma.supplierInvoice.update({ where: { id: inv.id }, data: { status: "CANCELED" } });
    expect((await syncLedger(controller, c.id, SEP)).reversed).toBe(1);
    expect((await syncLedger(controller, c.id, SEP)).reversed).toBe(0);
    // folha importada (centro de custo 100) → pessoal; absorção reduz a folha sem duplicar o custo do projeto
    await importPayroll(controller, c.id, SEP, "folha.csv", "centro;descrição;valor\n100;Folha 09/2026;5.000,00\n");
    const d = await dre(controller, { companyId: c.id, from: SEP, to: SEP });
    expect([d.totals.revenue, d.totals.net, d.totals.direct, d.totals.opex, d.totals.result].map(String)).toEqual(["3000", "2700", "2000", "3000", "-2300"]);
    // P&L do projeto: original × revisado × realizado × previsto
    const pl = await projectPl(controller, project.id);
    expect([pl.original?.revenue.toString(), pl.actual.labor.toString(), pl.actual.thirdParty.toString(), pl.actual.revenue.toString()]).toEqual(["20000", "2000", "0", "2700"]);
    expect(pl.forecast.cost.gte(pl.actualCost)).toBe(true);
    void ctx;
  });

  it("rateio preserva a soma, é único por competência, estornável e versionado", async () => {
    const { org, c, cc, project, controller } = await setup();
    await syncLedger(controller, c.id, SEP);
    await importPayroll(controller, c.id, SEP, "folha.csv", "100;Folha;5000\n900;Administrativo;2000\n");
    const accs = new Map((await prisma.managerialAccount.findMany({ where: { organizationId: org.id } })).map((a) => [a.systemKey, a.id]));
    const ccAdm = await prisma.costCenter.findFirstOrThrow({ where: { organizationId: org.id, code: "900" } });
    const before = await total(org.id);
    const rule = await saveAllocationRule(controller, null, { companyId: c.id, name: "Administrativo → operação", sourceAccountId: accs.get("PAYROLL")!, sourceCostCenterId: ccAdm.id, basis: "FIXED_PERCENT", targetAccountId: accs.get("ALLOCATED_OVERHEAD")!, validFrom: "2026-01-01", targets: JSON.stringify([{ projectId: project.id, percent: "33.33" }, { costCenterId: cc.id, percent: "66.67" }]) });
    await expect(saveAllocationRule(controller, null, { companyId: c.id, name: "Inválida", sourceAccountId: accs.get("PAYROLL")!, basis: "FIXED_PERCENT", targetAccountId: accs.get("ALLOCATED_OVERHEAD")!, validFrom: "2026-01-01", targets: JSON.stringify([{ projectId: project.id, percent: "50" }]) })).rejects.toThrow(/100%/);
    const run = await runAllocation(controller, rule.id, SEP);
    const parts = await prisma.managerialEntry.findMany({ where: { sourceType: "ALLOCATION", sourceId: run.id } });
    expect(parts.map((p) => Number(p.amount)).sort((a, b) => a - b)).toEqual([-2000, 666.6, 1333.4]);
    expect(sum(parts.map((p) => p.amount)).toString()).toBe("0");
    expect((await total(org.id)).toString()).toBe(before.toString()); // soma após rateio = soma antes (AC21)
    await expect(runAllocation(controller, rule.id, SEP)).rejects.toThrow(/já executado/);
    await reverseAllocation(controller, run.id, "Percentuais revistos");
    const v2 = await saveAllocationRule(controller, rule.id, { companyId: c.id, name: "Administrativo → operação (horas)", sourceAccountId: accs.get("PAYROLL")!, sourceCostCenterId: ccAdm.id, basis: "HOURS", targetAccountId: accs.get("ALLOCATED_OVERHEAD")!, validFrom: SEP });
    expect(v2.version).toBe(2);
    const run2 = await runAllocation(controller, v2.id, SEP);
    expect((await prisma.managerialEntry.findMany({ where: { sourceId: run2.id } })).find((e) => e.projectId === project.id)?.amount.toString()).toBe("2000");
    expect((await total(org.id)).toString()).toBe(before.toString());
  });

  it("orçamento versionado e orçado × realizado; fechamento bloqueia alterações e reabertura exige permissão e justificativa", async () => {
    const { ctx, org, c, controller } = await setup();
    await syncLedger(controller, c.id, SEP);
    const accs = new Map((await prisma.managerialAccount.findMany({ where: { organizationId: org.id } })).map((a) => [a.systemKey, a.id]));
    const b = await createBudget(controller, { companyId: c.id, year: 2026, kind: "BUDGET", name: "Orçamento 2026" });
    await setBudgetLines(controller, b.id, [{ accountId: accs.get("REVENUE_PROJECTS")!, month: SEP, amount: "4000" }, { accountId: accs.get("LABOR_COST")!, month: SEP, amount: "1800" }]);
    await approveBudget(controller, b.id);
    await expect(setBudgetLines(controller, b.id, [{ accountId: accs.get("LABOR_COST")!, month: SEP, amount: "1" }])).rejects.toThrow(/nova versão/);
    const fc = await createBudget(controller, { companyId: c.id, year: 2026, kind: "FORECAST", name: "Forecast 1", basedOnId: b.id });
    expect(await prisma.budgetLine.count({ where: { budgetId: fc.id } })).toBe(2);
    const bva = await budgetVsActual(controller, c.id, 2026);
    expect(bva.rows.filter((r) => ["REVENUE_PROJECTS", "LABOR_COST"].includes(r.account.systemKey ?? "")).map((r) => [r.planned.toString(), r.actual.toString()])).toEqual([["4000", "3000"], ["1800", "2000"]]);
    // fechamento
    expect((await closingChecklist(controller, c.id, SEP)).every((x) => x.count === 0)).toBe(true);
    const fin = await addUser(org.id, ["finance"]);
    await expect(closePeriod(fin, { companyId: c.id, month: SEP, force: false })).rejects.toThrow();
    await closePeriod(controller, { companyId: c.id, month: SEP, force: false });
    await expect(syncLedger(controller, c.id, SEP)).rejects.toThrow(/fechado/);
    await expect(createManualTitle(ctx, { kind: "PAYABLE", companyId: c.id, description: "Retroativo", issueDate: "2026-09-10", dueDate: "2026-10-10", competence: "2026-09-10", amount: "10" })).rejects.toThrow(/fechado/);
    await expect(reopenPeriod(controller, c.id, SEP, "curto")).rejects.toThrow(/Justifique/);
    await expect(reopenPeriod(fin, c.id, SEP, "Ajuste de provisão solicitado pela diretoria")).rejects.toThrow();
    await reopenPeriod(controller, c.id, SEP, "Ajuste de provisão solicitado pela diretoria");
    const logs = await prisma.auditLog.findMany({ where: { organizationId: org.id, action: { in: ["period.close", "period.reopen"] } } });
    expect(logs.map((l) => l.action).sort()).toEqual(["period.close", "period.reopen"]);
    expect(logs.find((l) => l.action === "period.reopen")?.reason).toMatch(/provisão/);
    await createManualTitle(ctx, { kind: "PAYABLE", companyId: c.id, description: "Retroativo", issueDate: "2026-09-10", dueDate: "2026-10-10", competence: "2026-09-10", amount: "10" });
  });
});
