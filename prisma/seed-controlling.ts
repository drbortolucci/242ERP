/**
 * Controladoria de demonstração (via serviços): folha consolidada derivada dos custos/hora dos profissionais CLT,
 * sincronização do razão, rateio do administrativo por horas, orçamento derivado das linhas de base, forecast,
 * aprovação das regras de reconhecimento e fechamento dos meses mais antigos.
 */
import { prisma } from "../src/server/db";
import type { DemoContext } from "./seed-demo";
import { syncLedger } from "../src/modules/controlling/ledger";
import { importPayroll, saveAllocationRule, runAllocation, createBudget, setBudgetLines, approveBudget, closePeriod } from "../src/modules/controlling/service";
import { costRateAt } from "../src/modules/professionals/service";
import { setSetting } from "../src/server/settings";
import { addMonths, monthStart, toCivil } from "../src/lib/dates";
import { dec, money } from "../src/lib/money";

export async function seedControlling(d: DemoContext) {
  const ctl = d.users.controladoria.ctx;
  const T = d.today;
  const cur = monthStart(T);
  const first = addMonths(cur, -5);
  const months: string[] = [];
  for (let m = first; m <= cur; m = addMonths(m, 1)) months.push(m);
  const ccs = await prisma.costCenter.findMany({ where: { organizationId: d.orgId } });
  const code = new Map(ccs.map((c) => [c.id, c.code]));
  const clt = await prisma.professional.findMany({ where: { organizationId: d.orgId, employmentType: "CLT", active: true } });
  const accounts = new Map((await prisma.managerialAccount.findMany({ where: { organizationId: d.orgId } })).map((a) => [a.systemKey, a.id]));

  for (const m of months.slice(0, -1)) {
    // Folha: custo/hora vigente × 168 h por profissional CLT, agrupado por centro de custo + estruturas sem apontamento
    for (const companyId of [d.companies.main, d.companies.second]) {
      const byCc = new Map<string, ReturnType<typeof dec>>();
      for (const p of clt.filter((x) => x.companyId === companyId && x.costCenterId)) {
        const rate = await costRateAt(prisma, p.id, m);
        if (rate) byCc.set(p.costCenterId!, (byCc.get(p.costCenterId!) ?? dec(0)).plus(dec(rate).times(168)));
      }
      const lines = [...byCc.entries()].map(([cc, v]) => `${code.get(cc)};Salários, encargos e benefícios;${money(v).toFixed(2)}`);
      if (companyId === d.companies.main) lines.push("900;Equipe administrativa e diretoria;38000.00", "800;Equipe comercial;22000.00");
      if (lines.length) await importPayroll(ctl, companyId, m, `folha-${m.slice(0, 7)}.csv`, lines.join("\n"));
    }
    for (const companyId of [d.companies.main, d.companies.second]) await syncLedger(ctl, companyId, m);
  }
  for (const companyId of [d.companies.main, d.companies.second]) await syncLedger(ctl, companyId, cur);

  // Rateio: administrativo (CC 900) para projetos pelas horas aprovadas
  const adm = ccs.find((c) => c.code === "900")!;
  const rule = await saveAllocationRule(ctl, null, { companyId: d.companies.main, name: "Administrativo por horas de projeto", sourceAccountId: accounts.get("PAYROLL")!, sourceCostCenterId: adm.id, basis: "HOURS", targetAccountId: accounts.get("ALLOCATED_OVERHEAD")!, validFrom: first });
  for (const m of months.slice(0, -1)) await runAllocation(ctl, rule.id, m).catch(() => undefined); // meses sem horas não têm base

  // Orçamento do ano derivado das linhas de base dos projetos + estrutura
  const year = Number(cur.slice(0, 4));
  const budget = await createBudget(ctl, { companyId: d.companies.main, year, kind: "BUDGET", name: `Orçamento ${year}` });
  const projects = await prisma.project.findMany({ where: { organizationId: d.orgId, companyId: d.companies.main } });
  const bls = await prisma.projectBaseline.findMany({ where: { projectId: { in: projects.map((p) => p.id) }, version: 1 } });
  const bms = await prisma.baselineMonth.findMany({ where: { baselineId: { in: bls.map((b) => b.id) } } });
  const lines: { accountId: string; costCenterId?: string | null; month: string; amount: string }[] = [];
  for (let i = 1; i <= 12; i++) {
    const m = `${year}-${String(i).padStart(2, "0")}-01`;
    const ms = bms.filter((x) => toCivil(x.month) === m);
    const s = (k: "revenue" | "laborCost" | "thirdPartyCost" | "expenseCost") => money(ms.reduce((a, x) => a.plus(x[k]), dec(0)));
    lines.push({ accountId: accounts.get("REVENUE_PROJECTS")!, month: m, amount: s("revenue").toFixed(2) }, { accountId: accounts.get("LABOR_COST")!, month: m, amount: s("laborCost").toFixed(2) }, { accountId: accounts.get("THIRD_PARTY_COST")!, month: m, amount: s("thirdPartyCost").toFixed(2) }, { accountId: accounts.get("PAYROLL")!, costCenterId: adm.id, month: m, amount: "38000.00" });
  }
  await setBudgetLines(ctl, budget.id, lines);
  await approveBudget(ctl, budget.id);
  await createBudget(ctl, { companyId: d.companies.main, year, kind: "FORECAST", name: `Forecast ${year} — revisão trimestral`, basedOnId: budget.id });

  await setSetting(ctl, "revenueRecognition", { approvedBy: "Cláudio Controller (demonstração)", approvedAt: new Date().toISOString() });
  // Fechamento dos três meses mais antigos (com justificativa se houver pendências residuais)
  for (const m of months.slice(0, 3)) for (const companyId of [d.companies.main, d.companies.second]) await closePeriod(ctl, { companyId, month: m, force: true, reason: "Fechamento da demonstração (pendências conhecidas)" });
}
