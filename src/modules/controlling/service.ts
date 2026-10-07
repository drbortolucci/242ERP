/**
 * Controladoria: rateios (soma preservada, idempotentes por regra/versão/competência, estornáveis), orçamentos e
 * forecasts versionados, importação de folha, DRE gerencial, orçado × realizado, P&L de projetos
 * (original × revisado × realizado × previsto) e fechamento/reabertura de períodos.
 */
import { z } from "zod";
import { requirePerm, requireAnyPerm, requireWritable, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { isPeriodOpen } from "@/server/periods";
import { conflict, notFound, rule, validation } from "@/lib/errors";
import { zDate, zOptId, zStr } from "@/lib/zod-helpers";
import { addMonths, civil, monthEnd, monthStart, toCivil, todayIn } from "@/lib/dates";
import { allocate, dec, money, sum } from "@/lib/money";
import { syncLedger } from "./ledger";
import { projectAnalytics } from "../projects/analytics";

// ------------------------------------------------------------------ Rateio
export const allocationRuleSchema = z.object({
  companyId: z.string().min(1), name: zStr(3), sourceAccountId: z.string().min(1), sourceCostCenterId: zOptId, basis: z.enum(["FIXED_PERCENT", "HOURS", "REVENUE"]),
  targetAccountId: z.string().min(1), validFrom: zDate, targets: z.string().optional(),
});
/** Alterar uma regra cria nova versão (as execuções antigas preservam a versão usada). */
export async function saveAllocationRule(ctx: Ctx, id: string | null, i: z.infer<typeof allocationRuleSchema>) {
  requireWritable(ctx);
  requirePerm(ctx, "controlling.write");
  let targets: { projectId?: string; costCenterId?: string; percent: string }[] = [];
  if (i.basis === "FIXED_PERCENT") {
    try { targets = JSON.parse(i.targets || "[]"); } catch { throw validation("Destinos inválidos."); }
    if (!targets.length || !sum(targets.map((t) => t.percent)).eq(100)) throw validation("Percentuais dos destinos devem somar 100%.");
  }
  const prev = id ? await ctx.db.allocationRule.findFirst({ where: { id } }) : null;
  if (prev) await ctx.db.allocationRule.update({ where: { id: prev.id }, data: { active: false, validTo: civil(monthEnd(addMonths(i.validFrom, -1))) } });
  const r = await ctx.db.allocationRule.create({ data: { organizationId: ctx.orgId, companyId: i.companyId, name: i.name, version: (prev?.version ?? 0) + 1, sourceAccountId: i.sourceAccountId, sourceCostCenterId: i.sourceCostCenterId ?? null, basis: i.basis, targets, targetAccountId: i.targetAccountId, validFrom: civil(i.validFrom), createdById: ctx.userId } });
  await audit(ctx, { action: prev ? "allocation_rule.version" : "allocation_rule.create", entity: "AllocationRule", entityId: r.id, changes: { version: r.version, basis: i.basis } });
  return r;
}

/** Executa o rateio: crédito na origem e débito nos destinos com o mesmo total (resto na última parcela). */
export async function runAllocation(ctx: Ctx, ruleId: string, monthIn: string) {
  requirePerm(ctx, "controlling.write");
  requireWritable(ctx);
  const month = monthStart(monthIn);
  const r = await ctx.db.allocationRule.findFirst({ where: { id: ruleId } });
  if (!r) throw notFound("Regra de rateio");
  if (toCivil(r.validFrom) > month || (r.validTo && toCivil(r.validTo) < month)) throw rule("Regra fora de vigência para a competência.");
  if (!(await isPeriodOpen(ctx.db, r.companyId, month))) throw rule("Período fechado.");
  if (await ctx.db.allocationRun.findFirst({ where: { ruleId, competence: civil(month), status: "POSTED" } })) throw conflict("Rateio já executado para a competência (estorne para refazer).");
  const comp = civil(month);
  const src = (await ctx.db.managerialEntry.aggregate({ where: { companyId: r.companyId, competence: comp, accountId: r.sourceAccountId, ...(r.sourceCostCenterId ? { costCenterId: r.sourceCostCenterId } : {}) }, _sum: { amount: true } }))._sum.amount;
  const total = money(src ?? 0);
  if (total.lte(0)) throw rule("Não há valor a ratear na origem para a competência.");
  let targets: { projectId?: string | null; costCenterId?: string | null; weight: ReturnType<typeof dec> }[] = [];
  if (r.basis === "FIXED_PERCENT") targets = (r.targets as { projectId?: string; costCenterId?: string; percent: string }[]).map((t) => ({ projectId: t.projectId ?? null, costCenterId: t.costCenterId ?? null, weight: dec(t.percent) }));
  else if (r.basis === "HOURS") {
    const g = await ctx.db.timeEntry.groupBy({ by: ["projectId"], where: { companyId: r.companyId, status: "APPROVED", projectId: { not: null }, date: { gte: comp, lte: civil(monthEnd(month)) } }, _sum: { hours: true } });
    targets = g.filter((x) => dec(x._sum.hours ?? 0).gt(0)).map((x) => ({ projectId: x.projectId, weight: dec(x._sum.hours!) }));
  } else {
    const revAcc = await ctx.db.managerialAccount.findMany({ where: { type: "REVENUE" }, select: { id: true } });
    const g = await ctx.db.managerialEntry.groupBy({ by: ["projectId"], where: { companyId: r.companyId, competence: comp, accountId: { in: revAcc.map((a) => a.id) }, projectId: { not: null } }, _sum: { amount: true } });
    targets = g.filter((x) => dec(x._sum.amount ?? 0).gt(0)).map((x) => ({ projectId: x.projectId, weight: dec(x._sum.amount!) }));
  }
  if (!targets.length) throw rule("Base de rateio vazia na competência (sem horas/receita nos destinos).");
  const parts = allocate(total, targets.map((t) => t.weight));
  return ctx.db.$transaction(async (tx) => {
    const run = await tx.allocationRun.create({ data: { organizationId: ctx.orgId, companyId: r.companyId, ruleId, ruleVersion: r.version, competence: comp, sourceAmount: total, createdById: ctx.userId } });
    const ref = `${r.id}@v${r.version}`;
    await tx.managerialEntry.create({ data: { organizationId: ctx.orgId, companyId: r.companyId, competence: comp, accountId: r.sourceAccountId, amount: total.negated(), costCenterId: r.sourceCostCenterId, sourceType: "ALLOCATION", sourceId: run.id, ruleRef: ref, description: `Rateio ${r.name} — saída da origem`, dedupeKey: `ALLOC:${run.id}:SRC`, createdById: ctx.userId } });
    for (const [i, t] of targets.entries()) await tx.managerialEntry.create({ data: { organizationId: ctx.orgId, companyId: r.companyId, competence: comp, accountId: r.targetAccountId, amount: parts[i], projectId: t.projectId ?? null, costCenterId: t.costCenterId ?? null, sourceType: "ALLOCATION", sourceId: run.id, ruleRef: ref, description: `Rateio ${r.name} — destino`, dedupeKey: `ALLOC:${run.id}:${i}`, createdById: ctx.userId } });
    await audit(ctx, { action: "allocation.run", entity: "AllocationRule", entityId: ruleId, companyId: r.companyId, changes: { month, total: total.toString(), targets: targets.length, version: r.version } }, tx);
    return run;
  });
}

export async function reverseAllocation(ctx: Ctx, runId: string, reason: string) {
  requireWritable(ctx);
  requirePerm(ctx, "controlling.write");
  if (!reason.trim()) throw validation("Informe o motivo.");
  await ctx.db.$transaction(async (tx) => {
    const run = await tx.allocationRun.findFirst({ where: { id: runId } });
    if (!run || run.status !== "POSTED") throw notFound("Execução de rateio");
    if (!(await isPeriodOpen(tx, run.companyId, toCivil(run.competence)))) throw rule("Período fechado.");
    for (const e of await tx.managerialEntry.findMany({ where: { sourceType: "ALLOCATION", sourceId: runId } })) await tx.managerialEntry.create({ data: { organizationId: ctx.orgId, companyId: e.companyId, competence: e.competence, accountId: e.accountId, amount: dec(e.amount).negated(), projectId: e.projectId, costCenterId: e.costCenterId, sourceType: "REVERSAL", sourceId: runId, reversalOfId: e.id, ruleRef: e.ruleRef, description: `Estorno de rateio: ${reason}`, dedupeKey: `REVERSAL:${e.dedupeKey}`, createdById: ctx.userId } });
    await tx.allocationRun.update({ where: { id: runId }, data: { status: "REVERSED" } });
    await audit(ctx, { action: "allocation.reverse", entity: "AllocationRun", entityId: runId, reason }, tx);
  });
}

// ------------------------------------------------------------------ Orçamento e forecast
export const budgetSchema = z.object({ companyId: z.string().min(1), year: z.coerce.number().int().min(2000).max(2100), kind: z.enum(["BUDGET", "FORECAST"]), name: zStr(3), basedOnId: zOptId });
export async function createBudget(ctx: Ctx, i: z.infer<typeof budgetSchema>) {
  requireWritable(ctx);
  requirePerm(ctx, "controlling.write");
  const last = await ctx.db.budget.findFirst({ where: { companyId: i.companyId, year: i.year, kind: i.kind }, orderBy: { version: "desc" } });
  return ctx.db.$transaction(async (tx) => {
    const b = await tx.budget.create({ data: { organizationId: ctx.orgId, companyId: i.companyId, year: i.year, kind: i.kind, version: (last?.version ?? 0) + 1, name: i.name, basedOnId: i.basedOnId ?? null, createdById: ctx.userId } });
    if (i.basedOnId) {
      const lines = await tx.budgetLine.findMany({ where: { budgetId: i.basedOnId } });
      if (lines.length) await tx.budgetLine.createMany({ data: lines.map((l) => ({ organizationId: ctx.orgId, budgetId: b.id, accountId: l.accountId, costCenterId: l.costCenterId, projectId: l.projectId, month: l.month, amount: l.amount })) });
    }
    await audit(ctx, { action: "budget.create", entity: "Budget", entityId: b.id, changes: { kind: i.kind, version: b.version, basedOn: i.basedOnId ?? null } }, tx);
    return b;
  });
}

/** Linhas: conta × centro de custo × projeto × mês (substitui a célula existente). Orçamento aprovado é imutável. */
export async function setBudgetLines(ctx: Ctx, budgetId: string, lines: { accountId: string; costCenterId?: string | null; projectId?: string | null; month: string; amount: string }[]) {
  requireWritable(ctx);
  requirePerm(ctx, "controlling.write");
  const b = await ctx.db.budget.findFirst({ where: { id: budgetId } });
  if (!b) throw notFound("Orçamento");
  if (b.status !== "DRAFT") throw rule("Versão aprovada não pode ser alterada: crie nova versão.");
  await ctx.db.$transaction(async (tx) => {
    for (const l of lines) {
      if (!l.month.startsWith(String(b.year))) throw validation(`Mês fora do exercício ${b.year}.`);
      const where = { budgetId, accountId: l.accountId, costCenterId: l.costCenterId ?? null, projectId: l.projectId ?? null, month: civil(monthStart(l.month)) };
      await tx.budgetLine.deleteMany({ where });
      if (!money(l.amount).isZero()) await tx.budgetLine.create({ data: { organizationId: ctx.orgId, ...where, amount: money(l.amount) } });
    }
    await audit(ctx, { action: "budget.lines", entity: "Budget", entityId: budgetId, changes: { lines: lines.length } }, tx);
  });
}

export async function approveBudget(ctx: Ctx, budgetId: string) {
  requireWritable(ctx);
  requirePerm(ctx, "controlling.write");
  const b = await ctx.db.budget.findFirst({ where: { id: budgetId } });
  if (!b || b.status !== "DRAFT") throw rule("Orçamento não está em rascunho.");
  await ctx.db.$transaction(async (tx) => {
    await tx.budget.updateMany({ where: { companyId: b.companyId, year: b.year, kind: b.kind, status: "APPROVED" }, data: { status: "SUPERSEDED" } });
    await tx.budget.update({ where: { id: budgetId }, data: { status: "APPROVED", approvedById: ctx.userId } });
    await audit(ctx, { action: "budget.approve", entity: "Budget", entityId: budgetId }, tx);
  });
}

// ------------------------------------------------------------------ Folha
/** Importa folha consolidada (CSV: centro de custo;descrição;valor) para a competência. */
export async function importPayroll(ctx: Ctx, companyId: string, competence: string, fileName: string, text: string) {
  requirePerm(ctx, "controlling.write");
  requireWritable(ctx);
  const month = monthStart(competence);
  if (!(await isPeriodOpen(ctx.db, companyId, month))) throw rule("Período fechado.");
  const ccs = new Map((await ctx.db.costCenter.findMany()).map((c) => [c.code, c.id]));
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).filter((l, i) => !(i === 0 && /centro|cost/i.test(l))).map((l, i) => {
    const [cc, description, value] = l.split(";").map((x) => x.trim());
    const ccId = ccs.get(cc);
    if (!ccId) throw validation(`Linha ${i + 1}: centro de custo "${cc}" não encontrado.`);
    const v = value?.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value;
    if (!v || Number.isNaN(Number(v))) throw validation(`Linha ${i + 1}: valor inválido.`);
    return { costCenterId: ccId, description: description || "Folha", amount: money(v) };
  });
  if (!lines.length) throw validation("Arquivo vazio.");
  const imp = await ctx.db.$transaction(async (tx) => {
    const imp = await tx.payrollImport.create({ data: { organizationId: ctx.orgId, companyId, competence: civil(month), fileName, totalAmount: money(sum(lines.map((l) => l.amount))), createdById: ctx.userId } });
    await tx.payrollImportLine.createMany({ data: lines.map((l) => ({ organizationId: ctx.orgId, importId: imp.id, ...l })) });
    await audit(ctx, { action: "payroll.import", entity: "PayrollImport", entityId: imp.id, companyId, changes: { month, lines: lines.length, total: imp.totalAmount.toString() } }, tx);
    return imp;
  });
  await syncLedger(ctx, companyId, month);
  return imp;
}

// ------------------------------------------------------------------ Relatórios
type Filter = { companyId?: string; from: string; to: string; costCenterId?: string; businessUnitId?: string; projectId?: string; partyId?: string };
async function entriesFor(ctx: Ctx, f: Filter) {
  return ctx.db.managerialEntry.findMany({ where: { competence: { gte: civil(monthStart(f.from)), lte: civil(monthStart(f.to)) }, ...(f.companyId ? { companyId: f.companyId } : {}), ...(f.costCenterId ? { costCenterId: f.costCenterId } : {}), ...(f.businessUnitId ? { businessUnitId: f.businessUnitId } : {}), ...(f.projectId ? { projectId: f.projectId } : {}), ...(f.partyId ? { partyId: f.partyId } : {}) } });
}

/** DRE gerencial por conta e mês, com subtotais. */
export async function dre(ctx: Ctx, f: Filter) {
  requirePerm(ctx, "controlling.read");
  const [entries, accounts] = await Promise.all([entriesFor(ctx, f), ctx.db.managerialAccount.findMany({ orderBy: { code: "asc" } })]);
  const months: string[] = [];
  for (let m = monthStart(f.from); m <= monthStart(f.to); m = addMonths(m, 1)) months.push(m);
  const byAcc = new Map<string, Map<string, ReturnType<typeof dec>>>();
  for (const e of entries) {
    const mm = byAcc.get(e.accountId) ?? new Map();
    const k = toCivil(e.competence);
    mm.set(k, (mm.get(k) ?? dec(0)).plus(e.amount));
    byAcc.set(e.accountId, mm);
  }
  const lines = accounts.filter((a) => byAcc.has(a.id)).map((a) => ({ account: a, values: months.map((m) => money(byAcc.get(a.id)?.get(m) ?? 0)), total: money(sum([...(byAcc.get(a.id)?.values() ?? [])])) }));
  const t = (type: string, pick: (a: (typeof accounts)[number]) => boolean = () => true) => months.map((_, i) => money(sum(lines.filter((l) => l.account.type === type && pick(l.account)).map((l) => l.values[i]))));
  const revenue = t("REVENUE");
  const deductions = t("DEDUCTION");
  const direct = t("DIRECT_COST");
  const opex = t("OPERATING_EXPENSE");
  const finIncome = t("FINANCIAL", (a) => a.systemKey === "FIN_INCOME");
  const finExpense = t("FINANCIAL", (a) => a.systemKey !== "FIN_INCOME");
  const net = revenue.map((r, i) => money(r.minus(deductions[i])));
  const margin = net.map((n, i) => money(n.minus(direct[i])));
  const operating = margin.map((m, i) => money(m.minus(opex[i])));
  const result = operating.map((o, i) => money(o.plus(finIncome[i]).minus(finExpense[i])));
  const tot = (arr: ReturnType<typeof money>[]) => money(sum(arr));
  return { months, lines, subtotals: { revenue, deductions, net, direct, margin, opex, operating, finIncome, finExpense, result }, totals: { revenue: tot(revenue), net: tot(net), direct: tot(direct), margin: tot(margin), opex: tot(opex), operating: tot(operating), result: tot(result) } };
}

/** Orçado × realizado por conta (orçamento aprovado do exercício). */
export async function budgetVsActual(ctx: Ctx, companyId: string, year: number, kind: "BUDGET" | "FORECAST" = "BUDGET") {
  requirePerm(ctx, "controlling.read");
  const b = await ctx.db.budget.findFirst({ where: { companyId, year, kind, status: "APPROVED" } });
  const [lines, accounts, actual] = await Promise.all([
    b ? ctx.db.budgetLine.findMany({ where: { budgetId: b.id } }) : [], ctx.db.managerialAccount.findMany({ orderBy: { code: "asc" } }),
    ctx.db.managerialEntry.groupBy({ by: ["accountId"], where: { companyId, competence: { gte: civil(`${year}-01-01`), lte: civil(`${year}-12-01`) } }, _sum: { amount: true } }),
  ]);
  const rows = accounts.map((a) => {
    const planned = money(sum(lines.filter((l) => l.accountId === a.id).map((l) => l.amount)));
    const real = money(actual.find((x) => x.accountId === a.id)?._sum.amount ?? 0);
    return { account: a, planned, actual: real, variance: money(real.minus(planned)), pct: planned.isZero() ? null : real.div(planned).times(100) };
  }).filter((r) => !r.planned.isZero() || !r.actual.isZero());
  return { budget: b, rows };
}

/** P&L do projeto: linha de base original × revisada × realizado (razão) × previsto ao término. */
export async function projectPl(ctx: Ctx, projectId: string) {
  requirePerm(ctx, "controlling.read");
  const a = await projectAnalytics(ctx, projectId);
  if (!a) throw notFound("Projeto");
  const entries = await ctx.db.managerialEntry.findMany({ where: { projectId } });
  const accounts = new Map((await ctx.db.managerialAccount.findMany()).map((x) => [x.id, x]));
  const by = (pred: (k: string | null, type: string) => boolean) => money(sum(entries.filter((e) => pred(accounts.get(e.accountId)?.systemKey ?? null, accounts.get(e.accountId)?.type ?? "")).map((e) => e.amount)));
  const actual = {
    revenue: by((_, t) => t === "REVENUE"), deductions: by((_, t) => t === "DEDUCTION"),
    labor: by((k) => k === "LABOR_COST"), thirdParty: by((k, t) => t === "DIRECT_COST" && k !== "LABOR_COST" && k !== "DIRECT_EXPENSES"),
    expenses: by((k) => k === "DIRECT_EXPENSES"), overhead: by((_, t) => t === "OPERATING_EXPENSE"),
  };
  const actualCost = money(sum([actual.labor, actual.thirdParty, actual.expenses]));
  const col = (revenue: ReturnType<typeof dec>, labor: ReturnType<typeof dec>, third: ReturnType<typeof dec>, exp: ReturnType<typeof dec>, other: ReturnType<typeof dec> = dec(0)) => {
    const cost = money(sum([labor, third, exp, other]));
    return { revenue: money(revenue), labor: money(labor), thirdParty: money(third), expenses: money(exp), cost, margin: money(dec(revenue).minus(cost)), marginPct: dec(revenue).isZero() ? null : dec(revenue).minus(cost).div(revenue).times(100) };
  };
  const o = a.original;
  const c = a.current;
  return {
    analytics: a,
    original: o ? col(o.revenue, o.laborCost, o.thirdPartyCost, o.expenseCost, o.otherCost) : null,
    revised: c ? col(c.revenue, c.laborCost, c.thirdPartyCost, c.expenseCost, c.otherCost) : null,
    actual: { ...col(actual.revenue.minus(actual.deductions), actual.labor, actual.thirdParty, actual.expenses), grossRevenue: actual.revenue, deductions: actual.deductions, overhead: actual.overhead },
    forecast: { revenue: money(a.forecast.revenue), cost: money(a.forecast.cost), margin: money(a.forecast.margin), marginPct: a.forecast.marginPct },
    actualCost,
  };
}

// ------------------------------------------------------------------ Fechamento
export async function closingChecklist(ctx: Ctx, companyId: string, monthIn: string) {
  requireAnyPerm(ctx, "controlling.read", "period.close");
  const month = monthStart(monthIn);
  const from = civil(month);
  const to = civil(monthEnd(month));
  const [timeSubmitted, measurementsPending, divergent, unreconciled, payablesPending, expensesPending] = await Promise.all([
    ctx.db.timeEntry.count({ where: { companyId, status: "SUBMITTED", date: { gte: from, lte: to } } }),
    ctx.db.measurement.count({ where: { companyId, competence: from, status: { in: ["DRAFT", "PENDING_APPROVAL"] } } }),
    ctx.db.supplierInvoice.count({ where: { companyId, competence: from, status: "DIVERGENT" } }),
    ctx.db.bankStatementLine.count({ where: { status: "PENDING", date: { gte: from, lte: to }, bankAccountId: { in: (await ctx.db.bankAccount.findMany({ where: { companyId }, select: { id: true } })).map((b) => b.id) } } }),
    ctx.db.payable.count({ where: { companyId, status: "PENDING_APPROVAL", competence: from } }),
    ctx.db.expense.count({ where: { companyId, status: "SUBMITTED", date: { gte: from, lte: to } } }),
  ]);
  return [
    { key: "time", label: "Apontamentos enviados e não aprovados", count: timeSubmitted, href: "/app/horas/aprovacao" },
    { key: "expenses", label: "Despesas aguardando aprovação", count: expensesPending, href: "/app/despesas" },
    { key: "measurements", label: "Medições em rascunho/aprovação", count: measurementsPending, href: "/app/faturamento/medicoes" },
    { key: "divergent", label: "Documentos de fornecedor divergentes", count: divergent, href: "/app/suprimentos/notas" },
    { key: "payables", label: "Contas a pagar aguardando aprovação", count: payablesPending, href: "/app/financeiro/pagar" },
    { key: "bank", label: "Linhas de extrato não conciliadas", count: unreconciled, href: "/app/financeiro/conciliacao" },
  ];
}

export const closeSchema = z.object({ companyId: z.string().min(1), month: zDate, force: z.preprocess((v) => v === "on" || v === "1" || v === true, z.boolean()).default(false), reason: z.string().optional() });
/** Fecha o período: sincroniza o razão, verifica pendências (exige justificativa para fechar com pendências) e bloqueia alterações. */
export async function closePeriod(ctx: Ctx, i: z.infer<typeof closeSchema>) {
  requirePerm(ctx, "period.close");
  requireWritable(ctx);
  const month = monthStart(i.month);
  if (month >= monthStart(todayIn(ctx.timezone))) throw rule("Só é possível fechar meses anteriores ao corrente.");
  const pending = (await closingChecklist(ctx, i.companyId, month)).filter((c) => c.count > 0);
  if (pending.length && !(i.force && i.reason?.trim())) throw rule(`Há pendências (${pending.map((p) => `${p.label}: ${p.count}`).join("; ")}). Resolva-as ou feche com justificativa.`);
  if (await isPeriodOpen(ctx.db, i.companyId, month)) await syncLedger(ctx, i.companyId, month);
  const p = await ctx.db.accountingPeriod.findFirst({ where: { companyId: i.companyId, month: civil(month) } });
  if (p?.status === "CLOSED") throw rule("Período já fechado.");
  if (p) await ctx.db.accountingPeriod.update({ where: { id: p.id }, data: { status: "CLOSED", closedById: ctx.userId, closedAt: new Date() } });
  else await ctx.db.accountingPeriod.create({ data: { organizationId: ctx.orgId, companyId: i.companyId, month: civil(month), status: "CLOSED", closedById: ctx.userId, closedAt: new Date() } });
  await audit(ctx, { action: "period.close", entity: "AccountingPeriod", entityId: `${i.companyId}:${month}`, companyId: i.companyId, reason: i.reason, changes: { month, pending: pending.map((x) => `${x.key}:${x.count}`) } });
}

export async function reopenPeriod(ctx: Ctx, companyId: string, monthIn: string, reason: string) {
  requirePerm(ctx, "period.reopen");
  requireWritable(ctx);
  if (reason.trim().length < 10) throw validation("Justifique a reabertura (mínimo 10 caracteres).");
  const month = monthStart(monthIn);
  const p = await ctx.db.accountingPeriod.findFirst({ where: { companyId, month: civil(month) } });
  if (!p || p.status !== "CLOSED") throw rule("Período não está fechado.");
  await ctx.db.accountingPeriod.update({ where: { id: p.id }, data: { status: "OPEN", reopenedById: ctx.userId, reopenedAt: new Date(), reopenReason: reason } });
  await audit(ctx, { action: "period.reopen", entity: "AccountingPeriod", entityId: `${companyId}:${month}`, companyId, reason });
}

/** Exportação contábil (CSV) dos lançamentos gerenciais da competência. */
export async function ledgerExportRows(ctx: Ctx, companyId: string, monthIn: string) {
  requirePerm(ctx, "controlling.read");
  const month = monthStart(monthIn);
  const [rows, accounts, ccs] = await Promise.all([ctx.db.managerialEntry.findMany({ where: { companyId, competence: civil(month) }, orderBy: { createdAt: "asc" } }), ctx.db.managerialAccount.findMany(), ctx.db.costCenter.findMany()]);
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const cc = new Map(ccs.map((c) => [c.id, c.code]));
  return rows.map((r) => ({ competencia: month.slice(0, 7), conta: acc.get(r.accountId)?.code ?? "", nomeConta: acc.get(r.accountId)?.name ?? "", centroCusto: r.costCenterId ? cc.get(r.costCenterId) ?? "" : "", projeto: r.projectId ?? "", valor: dec(r.amount).toFixed(2), origem: r.sourceType, documento: r.sourceId ?? "", historico: r.description ?? "" }));
}
