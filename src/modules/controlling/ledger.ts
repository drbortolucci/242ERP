/**
 * Razão gerencial: sincronização idempotente das operações em lançamentos por competência (empresa + mês).
 * Cada lançamento tem chave única (dedupeKey) — reprocessar não duplica. Períodos fechados não recebem lançamentos.
 * Convenção de sinal: valor no sentido natural da conta (receita positiva = receita; custo positivo = custo).
 *
 *  Horas aprovadas em projeto ........ Custo de pessoal alocado (+) e Pessoal absorvido por projetos (−) — sem duplicar a folha
 *  Folha importada / NF de PJ ........ Pessoal (folha) (+)
 *  NF de fornecedor aprovada ......... conta do pedido (padrão: terceiros) no projeto/centro de custo do pedido
 *  Despesa aprovada .................. conta da categoria (padrão: despesas diretas se em projeto, administrativas se não)
 *  Títulos recorrentes/avulsos a pagar  conta do título (padrão: despesas administrativas)
 *  Receita ........................... pelo método do contrato (horas medidas, marcos aceitos, linear, % de conclusão por horas)
 *  Deduções gerenciais ............... receita × alíquota gerencial do contrato (informada pela empresa)
 *  Financeiro ........................ juros/multas/descontos das liquidações
 *  Comissões ......................... provisões e reversões
 *  Venda de produtos (entregue) ...... receita por item (conta do produto ou venda de mercadorias) e frete
 *  Estoque ........................... custo das mercadorias vendidas (saídas por venda e estornos), consumo
 *                                       apropriado a projeto/centro de custo, perdas e ajustes de inventário.
 *                                       Compras de itens de estoque não são custo na compra: viram custo na saída.
 */
import { requirePerm, requireWritable, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { isPeriodOpen } from "@/server/periods";
import { rule } from "@/lib/errors";
import { addMonths, civil, monthEnd, monthStart, toCivil } from "@/lib/dates";
import { dec, money, sum } from "@/lib/money";
import { zonedInstant } from "@/domain/sla";

export interface Posting { accountKey?: string; accountId?: string; amount: ReturnType<typeof dec>; dedupeKey: string; sourceType: string; sourceId?: string | null; projectId?: string | null; contractId?: string | null; costCenterId?: string | null; businessUnitId?: string | null; partyId?: string | null; professionalId?: string | null; supplierPartyId?: string | null; serviceId?: string | null; description: string; ruleRef?: string; companyId: string }

const REVENUE_ACCOUNT: Record<string, string> = { AMS_RECURRING: "REVENUE_AMS", MONTHLY_ALLOCATION: "REVENUE_ALLOCATION" };

export async function accountIds(ctx: Ctx) {
  const rows = await ctx.db.managerialAccount.findMany({ where: { systemKey: { not: null } } });
  return new Map(rows.map((r) => [r.systemKey!, r.id]));
}

/** Gera (sem gravar) os lançamentos esperados da competência. */
export async function expectedPostings(ctx: Ctx, companyId: string, month: string): Promise<Posting[]> {
  const from = civil(monthStart(month));
  const to = civil(monthEnd(month));
  const out: Posting[] = [];
  const [profs, projects, contracts] = await Promise.all([ctx.db.professional.findMany(), ctx.db.project.findMany(), ctx.db.contract.findMany({ where: { companyId } })]);
  const prof = new Map(profs.map((p) => [p.id, p]));
  const proj = new Map(projects.map((p) => [p.id, p]));
  const contr = new Map((await ctx.db.contract.findMany()).map((c) => [c.id, c]));

  // 1) Horas: custo no projeto (empresa do projeto) e absorção no centro de custo do profissional (empresa do profissional)
  const entries = await ctx.db.timeEntry.findMany({ where: { status: "APPROVED", date: { gte: from, lte: to }, projectId: { not: null }, costAmount: { not: null } } });
  for (const e of entries) {
    const p = prof.get(e.professionalId);
    const pr = proj.get(e.projectId!);
    const c = e.contractId ? contr.get(e.contractId) : null;
    const cost = dec(e.costAmount!);
    if (cost.isZero()) continue;
    if (e.companyId === companyId) out.push({ companyId, accountKey: "LABOR_COST", amount: cost, dedupeKey: `TIME:${e.id}`, sourceType: "TIME_COST", sourceId: e.id, projectId: e.projectId, contractId: e.contractId, costCenterId: pr?.costCenterId ?? c?.costCenterId ?? null, businessUnitId: pr?.businessUnitId ?? c?.businessUnitId ?? null, partyId: c?.partyId ?? pr?.partyId ?? null, professionalId: e.professionalId, description: `Horas ${p?.name ?? ""} (${toCivil(e.date)})` });
    if ((p?.companyId ?? e.companyId) === companyId) out.push({ companyId, accountKey: "LABOR_ABSORPTION", amount: cost.negated(), dedupeKey: `ABSORB:${e.id}`, sourceType: "LABOR_ABSORPTION", sourceId: e.id, costCenterId: p?.costCenterId ?? null, businessUnitId: p?.businessUnitId ?? null, professionalId: e.professionalId, description: `Absorção de pessoal por projeto — ${p?.name ?? ""}` });
  }
  // 2) Documentos de fornecedor aprovados (e estorno dos cancelados já lançados)
  const invs = await ctx.db.supplierInvoice.findMany({ where: { companyId, competence: { gte: from, lte: to }, status: { in: ["APPROVED", "CANCELED"] } } });
  const pos = new Map((await ctx.db.purchaseOrder.findMany({ where: { id: { in: invs.map((i) => i.purchaseOrderId).filter((x): x is string => !!x) } } })).map((p) => [p.id, p]));
  const stockShare = new Map<string, ReturnType<typeof dec>>();
  if (pos.size) {
    const poLines = await ctx.db.purchaseOrderLine.findMany({ where: { purchaseOrderId: { in: [...pos.keys()] }, productId: { not: null } } });
    const tracked = new Set((await ctx.db.product.findMany({ where: { id: { in: poLines.map((l) => l.productId!) }, tracksStock: true }, select: { id: true } })).map((p) => p.id));
    for (const po of pos.values()) {
      const stockAmount = sum(poLines.filter((l) => l.purchaseOrderId === po.id && tracked.has(l.productId!)).map((l) => l.amount));
      if (stockAmount.gt(0) && dec(po.totalAmount).gt(0)) stockShare.set(po.id, stockAmount.div(dec(po.totalAmount)).gt(1) ? dec(1) : stockAmount.div(dec(po.totalAmount)));
    }
  }
  for (const i of invs) {
    if (i.status !== "APPROVED") continue;
    const po = i.purchaseOrderId ? pos.get(i.purchaseOrderId) : null;
    // PJ: o custo chega ao projeto pelas horas aprovadas — a NF não é apropriada ao projeto (evita duplicidade)
    const toProject = po?.projectId && po.kind !== "PJ_PROFESSIONAL" ? po.projectId : null;
    // Itens de estoque do pedido não são custo na compra (entram no estoque; o custo ocorre na saída)
    const share = po ? stockShare.get(po.id) ?? dec(0) : dec(0);
    const amount = share.gt(0) ? money(dec(i.amount).times(dec(1).minus(share))) : dec(i.amount);
    if (amount.isZero()) continue;
    out.push({ companyId, accountId: po?.accountId ?? undefined, accountKey: po?.accountId ? undefined : "THIRD_PARTY_COST", amount, dedupeKey: `SUPINV:${i.id}`, sourceType: "SUPPLIER_INVOICE", sourceId: i.id, projectId: toProject, costCenterId: po?.costCenterId ?? null, supplierPartyId: i.supplierPartyId, contractId: toProject ? proj.get(toProject)?.contractId ?? null : null, description: `Documento ${i.number} — pedido ${po?.number ?? ""}` });
  }
  // 3) Despesas aprovadas
  const cats = new Map((await ctx.db.expenseCategory.findMany()).map((c) => [c.id, c]));
  for (const e of await ctx.db.expense.findMany({ where: { companyId, status: "APPROVED", date: { gte: from, lte: to } } })) {
    const p = e.professionalId ? prof.get(e.professionalId) : null;
    const pr = e.projectId ? proj.get(e.projectId) : null;
    const catAcc = cats.get(e.categoryId)?.accountId;
    out.push({ companyId, accountId: catAcc ?? undefined, accountKey: catAcc ? undefined : e.projectId ? "DIRECT_EXPENSES" : "ADMIN_EXPENSES", amount: dec(e.amount), dedupeKey: `EXP:${e.id}`, sourceType: "EXPENSE", sourceId: e.id, projectId: e.projectId, contractId: pr?.contractId ?? e.contractId, costCenterId: e.costCenterId ?? pr?.costCenterId ?? p?.costCenterId ?? null, professionalId: e.professionalId, description: `Despesa: ${e.description}` });
  }
  // 4) Títulos a pagar recorrentes e avulsos
  for (const p of await ctx.db.payable.findMany({ where: { companyId, sourceType: { in: ["RECURRING", "MANUAL"] }, status: { notIn: ["CANCELED", "PENDING_APPROVAL"] }, competence: { gte: from, lte: to } } })) {
    out.push({ companyId, accountId: p.accountId ?? undefined, accountKey: p.accountId ? undefined : "ADMIN_EXPENSES", amount: dec(p.amount), dedupeKey: `PAY:${p.id}`, sourceType: "MANUAL_ADJUSTMENT", sourceId: p.id, projectId: p.projectId, costCenterId: p.costCenterId, supplierPartyId: p.partyId, description: p.description ?? `Título ${p.number}` });
  }
  // 5) Receita reconhecida pelo método do contrato + dedução gerencial
  const addRevenue = (c: (typeof contracts)[number], amount: ReturnType<typeof dec>, key: string, description: string, ruleRef: string, extra: Partial<Posting> = {}) => {
    if (amount.isZero()) return;
    const base = { companyId, contractId: c.id, partyId: c.partyId, businessUnitId: c.businessUnitId, costCenterId: c.costCenterId, ruleRef, projectId: projects.find((p) => p.contractId === c.id)?.id ?? null, ...extra };
    out.push({ ...base, accountKey: extra.accountKey ?? REVENUE_ACCOUNT[c.commercialModel] ?? "REVENUE_PROJECTS", amount, dedupeKey: key, sourceType: "REVENUE_RECOGNITION", description });
    const rate = dec(c.taxRatePct);
    if (rate.gt(0)) out.push({ ...base, accountKey: "DEDUCTION_TAXES", amount: money(amount.times(rate).div(100)), dedupeKey: `DED:${key}`, sourceType: "DEDUCTION", description: `Dedução gerencial (${rate.toFixed(2)}%) — ${description}` });
  };
  const measurements = await ctx.db.measurement.findMany({ where: { companyId, competence: civil(monthStart(month)), status: { in: ["APPROVED", "CLIENT_PENDING", "CLIENT_APPROVED", "PARTIALLY_INVOICED", "INVOICED"] } } });
  const items = await ctx.db.measurementItem.findMany({ where: { measurementId: { in: measurements.map((m) => m.id) }, status: { not: "REMOVED" } } });
  for (const it of items) {
    const m = measurements.find((x) => x.id === it.measurementId)!;
    const c = contr.get(m.contractId)!;
    const method = c.revenueMethod;
    if (it.sourceType === "EXPENSE") { addRevenue(c, dec(it.amount), `REV:${it.id}`, `Reembolso de despesa — ${m.number}`, "ON_MEASUREMENT", { accountKey: "REVENUE_REIMBURSEMENT", projectId: it.projectId }); continue; }
    if (method === "PERCENT_COMPLETE_HOURS" && it.sourceType !== "AMS_OVERAGE" && it.sourceType !== "ADJUSTMENT") continue; // coberto pelo % de conclusão
    if (method === "STRAIGHT_LINE" && !["AMS_OVERAGE", "ADJUSTMENT"].includes(it.sourceType)) continue; // linearização cobre o valor do contrato (mensalidade, marcos, horas)
    if (method === "MILESTONE" && it.sourceType === "MILESTONE") continue; // reconhecido no aceite
    addRevenue(c, dec(it.amount), `REV:${it.id}`, `${it.description} — ${m.number}`, "ON_MEASUREMENT", { projectId: it.projectId ?? undefined, serviceId: it.serviceId });
  }
  for (const c of contracts.filter((x) => ["ACTIVE", "ENDED", "SUSPENDED"].includes(x.status))) {
    const start = monthStart(toCivil(c.startDate));
    const end = c.endDate ? toCivil(c.endDate) : null;
    if (start > month || (end && monthStart(end) < month)) continue;
    if (c.revenueMethod === "STRAIGHT_LINE") {
      let monthly = c.monthlyFee ? dec(c.monthlyFee) : dec(0);
      if (monthly.isZero() && end) { let n = 0; for (let m = start; m <= monthStart(end); m = addMonths(m, 1)) n++; monthly = money(dec(c.totalValue).div(n)); }
      addRevenue(c, money(monthly), `REV:SL:${c.id}:${month.slice(0, 7)}`, `Receita linear ${month.slice(5, 7)}/${month.slice(0, 4)} — ${c.number}`, "STRAIGHT_LINE");
    }
    if (c.revenueMethod === "MILESTONE") {
      for (const ms of await ctx.db.contractMilestone.findMany({ where: { contractId: c.id, acceptedAt: { gte: zonedInstant(month, 0, ctx.timezone), lt: zonedInstant(addMonths(month, 1), 0, ctx.timezone) } } })) addRevenue(c, dec(ms.amount), `REV:MS:${ms.id}`, `Marco aceito: ${ms.name}`, "MILESTONE");
    }
    if (c.revenueMethod === "PERCENT_COMPLETE_HOURS") {
      const pr = projects.find((p) => p.contractId === c.id);
      if (!pr) continue;
      const bl = await ctx.db.projectBaseline.findFirst({ where: { projectId: pr.id }, orderBy: { version: "desc" } });
      const total = dec(c.totalValue).gt(0) ? dec(c.totalValue) : dec(bl?.revenue ?? 0);
      const effort = dec(bl?.effortHours ?? 0);
      if (total.isZero() || effort.isZero()) continue;
      const hours = (await ctx.db.timeEntry.aggregate({ where: { contractId: c.id, status: "APPROVED", date: { lte: to } }, _sum: { hours: true } }))._sum.hours ?? 0;
      const pct = dec(hours).div(effort);
      const target = money(total.times(pct.gt(1) ? 1 : pct));
      // acumulado reconhecido até esta competência (meses posteriores se ajustam ao serem sincronizados)
      const prev = (await ctx.db.managerialEntry.aggregate({ where: { contractId: c.id, ruleRef: "PERCENT_COMPLETE_HOURS", sourceType: "REVENUE_RECOGNITION", competence: { lte: civil(monthStart(month)) } }, _sum: { amount: true } }))._sum.amount ?? 0;
      const delta = money(target.minus(dec(prev)));
      if (!delta.isZero()) addRevenue(c, delta, `REV:POC:${c.id}:${month.slice(0, 7)}:${target.toFixed(2)}`, `Receita por % de conclusão (${pct.times(100).toFixed(1)}% das horas) — ${c.number}`, "PERCENT_COMPLETE_HOURS", { projectId: pr.id });
    }
  }
  // 6) Resultado financeiro das liquidações
  for (const s of await ctx.db.settlement.findMany({ where: { companyId, date: { gte: from, lte: to } } })) {
    const charges = dec(s.interest).plus(s.fine);
    const disc = dec(s.discount);
    const inc = s.direction === "IN" ? charges : disc;
    const exp = s.direction === "IN" ? disc : charges;
    if (!inc.isZero()) out.push({ companyId, accountKey: "FIN_INCOME", amount: inc, dedupeKey: `FIN:${s.id}:IN`, sourceType: "MANUAL_ADJUSTMENT", sourceId: s.id, description: `${s.direction === "IN" ? "Juros/multa recebidos" : "Desconto obtido"}${s.reversalOfId ? " (estorno)" : ""}` });
    if (!exp.isZero()) out.push({ companyId, accountKey: "FIN_EXPENSE", amount: exp, dedupeKey: `FIN:${s.id}:EX`, sourceType: "MANUAL_ADJUSTMENT", sourceId: s.id, description: `${s.direction === "IN" ? "Desconto concedido" : "Juros/multa pagos"}${s.reversalOfId ? " (estorno)" : ""}` });
  }
  // 7) Comissões (provisões e reversões)
  for (const ce of await ctx.db.commissionEntry.findMany({ where: { competence: { gte: from, lte: to }, contractId: { in: contracts.map((c) => c.id) } } })) {
    const c = contr.get(ce.contractId!)!;
    out.push({ companyId, accountKey: "COMMISSIONS", amount: dec(ce.amount), dedupeKey: `COMM:${ce.id}`, sourceType: "MANUAL_ADJUSTMENT", sourceId: ce.id, contractId: c.id, partyId: c.partyId, businessUnitId: c.businessUnitId, description: `Comissão ${ce.kind === "REVERSAL" ? "(reversão) " : ""}— ${c.number}` });
  }
  // 8) Folha importada
  const imports = await ctx.db.payrollImport.findMany({ where: { companyId, competence: civil(monthStart(month)), status: "POSTED" } });
  for (const l of await ctx.db.payrollImportLine.findMany({ where: { importId: { in: imports.map((i) => i.id) } } })) out.push({ companyId, accountKey: "PAYROLL", amount: dec(l.amount), dedupeKey: `PAYROLL:${l.id}`, sourceType: "PAYROLL_IMPORT", sourceId: l.importId, costCenterId: l.costCenterId, professionalId: l.professionalId, description: l.description });
  // 9) Venda de produtos entregue: receita por item e frete
  const orders = await ctx.db.productOrder.findMany({ where: { companyId, status: "DELIVERED", deliveredAt: { gte: from, lte: to } } });
  if (orders.length) {
    const olines = await ctx.db.productOrderLine.findMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
    const prods = new Map((await ctx.db.product.findMany({ where: { id: { in: olines.map((l) => l.productId) } } })).map((p) => [p.id, p]));
    for (const o of orders) {
      for (const l of olines.filter((x) => x.orderId === o.id)) {
        const p = prods.get(l.productId);
        if (dec(l.amount).isZero()) continue;
        out.push({ companyId, accountId: p?.revenueAccountId ?? undefined, accountKey: p?.revenueAccountId ? undefined : "REVENUE_GOODS", amount: dec(l.amount), dedupeKey: `GSALE:${l.id}`, sourceType: "REVENUE_RECOGNITION", sourceId: o.id, partyId: o.partyId, description: `Venda ${o.number} — ${l.description}`, ruleRef: "ON_DELIVERY" });
      }
      if (dec(o.freightAmount).gt(0)) out.push({ companyId, accountKey: "REVENUE_GOODS", amount: dec(o.freightAmount), dedupeKey: `GSALE:FRT:${o.id}`, sourceType: "REVENUE_RECOGNITION", sourceId: o.id, partyId: o.partyId, description: `Frete cobrado — ${o.number}`, ruleRef: "ON_DELIVERY" });
    }
  }
  // 10) Estoque: custo das vendas, consumo e ajustes (custo positivo = despesa; entradas de ajuste reduzem o custo)
  const movs = await ctx.db.stockMovement.findMany({ where: { companyId, date: { gte: from, lte: to }, type: { in: ["SALE", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "COUNT_ADJUSTMENT", "CONSUMPTION", "REVERSAL"] } } });
  if (movs.length) {
    const origins = new Map((await ctx.db.stockMovement.findMany({ where: { id: { in: movs.map((m) => m.reversalOfId).filter((x): x is string => !!x) } } })).map((m) => [m.id, m]));
    const prods = new Map((await ctx.db.product.findMany({ where: { id: { in: movs.map((m) => m.productId) } } })).map((p) => [p.id, p]));
    for (const m of movs) {
      const kind = m.type === "REVERSAL" ? origins.get(m.reversalOfId ?? "")?.type : m.type;
      if (!kind || !["SALE", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "COUNT_ADJUSTMENT", "CONSUMPTION"].includes(kind)) continue;
      const amount = money(dec(m.totalCost).negated());
      if (amount.isZero()) continue;
      const p = prods.get(m.productId);
      const base = { companyId, amount, dedupeKey: `STK:${m.id}`, sourceId: m.id, projectId: m.projectId, costCenterId: m.costCenterId, partyId: m.partyId, description: `${m.number} — ${p?.code ?? ""} ${p?.name ?? ""}${m.type === "REVERSAL" ? " (estorno)" : ""}` };
      if (kind === "SALE") out.push({ ...base, accountId: p?.costAccountId ?? undefined, accountKey: p?.costAccountId ? undefined : "COGS", sourceType: "COGS" });
      else if (kind === "CONSUMPTION") out.push({ ...base, accountId: p?.costAccountId ?? undefined, accountKey: p?.costAccountId ? undefined : "LICENSE_COST", sourceType: "STOCK_CONSUMPTION", contractId: m.projectId ? proj.get(m.projectId)?.contractId ?? null : null });
      else out.push({ ...base, accountKey: "INVENTORY_ADJUSTMENTS", sourceType: "STOCK_ADJUSTMENT" });
    }
  }
  return out;
}

/** Lança o que falta e estorna o que deixou de existir (ex.: documento de fornecedor cancelado). */
export async function syncLedger(ctx: Ctx, companyId: string, monthIn: string) {
  requirePerm(ctx, "controlling.write");
  requireWritable(ctx);
  const month = monthStart(monthIn);
  if (!(await isPeriodOpen(ctx.db, companyId, month))) throw rule(`Período ${month.slice(5, 7)}/${month.slice(0, 4)} fechado: reabra para reprocessar.`);
  const accounts = await accountIds(ctx);
  const expected = await expectedPostings(ctx, companyId, month);
  const existing = await ctx.db.managerialEntry.findMany({ where: { companyId, competence: civil(month), dedupeKey: { not: null } }, select: { id: true, dedupeKey: true, amount: true, accountId: true, sourceType: true, sourceId: true, projectId: true, costCenterId: true, contractId: true, reversalOfId: true } });
  const have = new Set(existing.map((e) => e.dedupeKey));
  const missing = expected.filter((p) => !have.has(p.dedupeKey));
  const rows = missing.map((p) => {
    const accountId = p.accountId ?? accounts.get(p.accountKey!);
    if (!accountId) throw rule(`Conta gerencial do sistema não configurada: ${p.accountKey}.`);
    return { organizationId: ctx.orgId, companyId: p.companyId, competence: civil(month), accountId, amount: money(p.amount), costCenterId: p.costCenterId ?? null, businessUnitId: p.businessUnitId ?? null, partyId: p.partyId ?? null, contractId: p.contractId ?? null, projectId: p.projectId ?? null, serviceId: p.serviceId ?? null, professionalId: p.professionalId ?? null, supplierPartyId: p.supplierPartyId ?? null, sourceType: p.sourceType, sourceId: p.sourceId ?? null, ruleRef: p.ruleRef ?? null, description: p.description, dedupeKey: p.dedupeKey, createdById: ctx.userId };
  });
  // estornos: lançamentos de origem que não é mais esperada (ex.: NF cancelada, item de medição removido)
  const expectedKeys = new Set(expected.map((p) => p.dedupeKey));
  const reversible = existing.filter((e) => e.dedupeKey && !e.reversalOfId && !e.dedupeKey.startsWith("REVERSAL:") && /^(SUPINV|REV|DED|EXP|PAY|GSALE):/.test(e.dedupeKey) && !/^REV:(POC|SL|MS):/.test(e.dedupeKey) && !/^DED:REV:(POC|SL|MS):/.test(e.dedupeKey) && !expectedKeys.has(e.dedupeKey) && !have.has(`REVERSAL:${e.dedupeKey}`));
  const reversals = reversible.map((e) => ({ organizationId: ctx.orgId, companyId, competence: civil(month), accountId: e.accountId, amount: dec(e.amount).negated(), projectId: e.projectId, costCenterId: e.costCenterId, contractId: e.contractId, sourceType: "REVERSAL", sourceId: e.sourceId, reversalOfId: e.id, description: "Estorno: origem cancelada", dedupeKey: `REVERSAL:${e.dedupeKey}`, createdById: ctx.userId }));
  await ctx.db.$transaction(async (tx) => {
    if (rows.length) await tx.managerialEntry.createMany({ data: rows, skipDuplicates: true });
    if (reversals.length) await tx.managerialEntry.createMany({ data: reversals, skipDuplicates: true });
    if (rows.length || reversals.length) await audit(ctx, { action: "ledger.sync", entity: "Company", entityId: companyId, companyId, changes: { month, posted: rows.length, reversed: reversals.length, total: money(sum(rows.map((r) => r.amount))).toString() } }, tx);
  });
  return { posted: rows.length, reversed: reversals.length, expected: expected.length };
}
