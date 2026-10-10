/**
 * Cobrança bancária de títulos a receber (boleto e PIX) e conciliação automática do extrato.
 *
 *  Emissão: título em aberto → cobrança no provedor (idempotente por título + tentativa) → código para o cliente.
 *  Baixa:   webhook autenticado do provedor (ou "simular pagamento" no ambiente simulado) → liquidação do título na
 *           conta bancária da cobrança, com juros/multa (valor pago acima do saldo) ou desconto (abaixo), idempotente.
 *  Extrato: conciliação automática de linhas com movimento único de mesmo valor em ±3 dias; regras por descrição
 *           (ex.: tarifas) geram o lançamento e conciliam.
 */
import { z } from "zod";
import { prisma } from "@/server/db";
import { requirePerm, requireWritable, systemCtx, type Ctx } from "@/server/context";
import { audit, auditPlatform } from "@/server/audit";
import { nextNumber } from "@/server/sequences";
import { bankingProvider } from "@/server/providers/banking";
import { conflict, notFound, rule, validation } from "@/lib/errors";
import { zBool, zOptDecimal, zOptId, zStr } from "@/lib/zod-helpers";
import { addDays, toCivil, todayIn } from "@/lib/dates";
import { dec, money } from "@/lib/money";
import { settle } from "@/modules/finance/service";
import { reconcile, createFromLine } from "@/modules/finance/treasury";

export const chargeSchema = z.object({ receivableId: z.string().min(1), method: z.enum(["BOLETO", "PIX"]), bankAccountId: z.string().min(1), finePct: zOptDecimal, interestPctMonth: zOptDecimal });

async function bankConfig(ctx: Ctx) {
  return ctx.db.integrationConfig.findFirst({ where: { kind: "BANK" } });
}

export async function issueCharge(ctx: Ctx, i: z.infer<typeof chargeSchema>) {
  requirePerm(ctx, "finance.write");
  requireWritable(ctx);
  const r = await ctx.db.receivable.findFirst({ where: { id: i.receivableId } });
  if (!r) throw notFound("Título a receber");
  if (!["OPEN", "PARTIAL"].includes(r.status) || dec(r.openAmount).lte(0)) throw rule("Título sem saldo em aberto.");
  const active = await ctx.db.bankCharge.findFirst({ where: { receivableId: r.id, status: { in: ["PENDING", "REGISTERED"] } } });
  if (active) throw conflict(`Já existe cobrança ${active.number} ativa para este título: cancele-a antes de emitir outra.`);
  const acc = await ctx.db.bankAccount.findFirst({ where: { id: i.bankAccountId, active: true } });
  if (!acc || acc.companyId !== r.companyId) throw validation("Conta bancária inválida para a empresa do título.");
  for (const v of [i.finePct, i.interestPctMonth]) if (v && (dec(v).lt(0) || dec(v).gt(20))) throw validation("Multa e juros devem estar entre 0% e 20% (conforme contrato e legislação aplicável).");
  const [party, company, cfg] = await Promise.all([ctx.db.party.findFirstOrThrow({ where: { id: r.partyId } }), ctx.db.company.findFirstOrThrow({ where: { id: r.companyId } }), bankConfig(ctx)]);
  const provider = bankingProvider(cfg?.enabled ? cfg.provider : null);
  const today = todayIn(ctx.timezone);
  const due = toCivil(r.dueDate) < today ? addDays(today, 3) : toCivil(r.dueDate); // título vencido: novo vencimento curto
  const attempts = await ctx.db.bankCharge.count({ where: { receivableId: r.id } });
  const key = `CHG:${r.id}:${attempts + 1}`;
  const number = await nextNumber(ctx.db, ctx.orgId, "BANK_CHARGE");
  const charge = await ctx.db.bankCharge.create({ data: { organizationId: ctx.orgId, companyId: r.companyId, number, receivableId: r.id, bankAccountId: acc.id, method: i.method, provider: provider.name, environment: provider.environment, idempotencyKey: key, amount: money(r.openAmount), dueDate: new Date(`${due}T00:00:00Z`), finePct: i.finePct ? dec(i.finePct) : null, interestPctMonth: i.interestPctMonth ? dec(i.interestPctMonth) : null, createdById: ctx.userId } });
  let res;
  try {
    res = await provider.createCharge({ idempotencyKey: key, method: i.method, amount: money(r.openAmount).toFixed(2), dueDate: due, finePct: i.finePct ?? null, interestPctMonth: i.interestPctMonth ?? null, payer: { name: party.name, document: party.document, email: party.email }, beneficiary: { cnpj: company.cnpj, name: company.legalName }, description: `${r.number}${r.description ? ` — ${r.description}` : ""}` });
  } catch (e) {
    await ctx.db.bankCharge.update({ where: { id: charge.id }, data: { status: "ERROR", lastError: (e as Error).message } });
    throw rule(`Falha na comunicação com o provedor de cobrança: ${(e as Error).message}`);
  }
  const updated = await ctx.db.bankCharge.update({ where: { id: charge.id }, data: { status: res.status, externalId: res.externalId, digitableLine: res.digitableLine ?? null, pixCode: res.pixCode ?? null, paymentUrl: res.paymentUrl ?? null, lastError: res.message ?? null } });
  await ctx.db.bankChargeEvent.create({ data: { organizationId: ctx.orgId, chargeId: charge.id, type: res.status === "ERROR" ? "ERROR" : "REGISTERED", payload: { externalId: res.externalId, message: res.message ?? null } } });
  await audit(ctx, { action: "bank_charge.issue", entity: "Receivable", entityId: r.id, companyId: r.companyId, changes: { charge: number, method: i.method, amount: money(r.openAmount).toString(), provider: provider.name, environment: provider.environment, status: res.status } });
  if (res.status === "ERROR") throw rule(`Cobrança recusada pelo provedor: ${res.message ?? "erro não informado"}`);
  return updated;
}

export async function cancelCharge(ctx: Ctx, chargeId: string, reason: string) {
  requirePerm(ctx, "finance.write");
  requireWritable(ctx);
  if (reason.trim().length < 3) throw validation("Informe o motivo.");
  const c = await ctx.db.bankCharge.findFirst({ where: { id: chargeId } });
  if (!c) throw notFound("Cobrança");
  if (!["PENDING", "REGISTERED", "ERROR"].includes(c.status)) throw rule("Cobrança paga, cancelada ou expirada não pode ser cancelada.");
  if (c.externalId && c.status === "REGISTERED") {
    const cfg = await bankConfig(ctx);
    const r = await bankingProvider(cfg?.enabled ? cfg.provider : null).cancelCharge(c.externalId);
    if (!r.ok) throw rule(`O provedor recusou a baixa: ${r.message ?? "sem detalhe"}`);
  }
  const u = await ctx.db.bankCharge.updateMany({ where: { id: c.id, status: c.status }, data: { status: "CANCELED", lastError: reason } });
  if (!u.count) throw conflict("A cobrança mudou de situação; atualize a página.");
  await ctx.db.bankChargeEvent.create({ data: { organizationId: ctx.orgId, chargeId: c.id, type: "CANCELED", payload: { reason } } });
  await audit(ctx, { action: "bank_charge.cancel", entity: "Receivable", entityId: c.receivableId, companyId: c.companyId, changes: { charge: c.number }, reason });
}

/**
 * Baixa por pagamento (idempotente): liquida o título na conta da cobrança. Pago acima do saldo = juros/multa;
 * abaixo = desconto concedido. Pagamento de cobrança já cancelada é registrado para tratamento manual.
 */
async function applyPayment(orgId: string, chargeId: string, paidAmountIn: string, paidAt: string) {
  const c = await prisma.bankCharge.findFirst({ where: { id: chargeId, organizationId: orgId } });
  if (!c) return { ok: false as const, status: 404 };
  if (c.status === "PAID") {
    await prisma.bankChargeEvent.create({ data: { organizationId: orgId, chargeId: c.id, type: "WEBHOOK_DUPLICATE", payload: { paidAmount: paidAmountIn, paidAt } } });
    return { ok: true as const, status: 200, duplicate: true };
  }
  const r = await prisma.receivable.findFirstOrThrow({ where: { id: c.receivableId } });
  const paid = money(paidAmountIn);
  if (paid.lte(0)) return { ok: false as const, status: 400 };
  if (c.status === "CANCELED" || ["PAID", "CANCELED", "WRITTEN_OFF"].includes(r.status)) {
    await prisma.bankCharge.update({ where: { id: c.id }, data: { lastError: `Pagamento de ${paid.toFixed(2)} recebido em ${paidAt} para cobrança cancelada ou título sem saldo: tratar manualmente (crédito do cliente).` } });
    await prisma.bankChargeEvent.create({ data: { organizationId: orgId, chargeId: c.id, type: "PAID", payload: { paidAmount: paid.toFixed(2), paidAt, applied: false } } });
    return { ok: true as const, status: 200, applied: false };
  }
  const open = money(r.openAmount);
  const principal = paid.gt(open) ? open : paid;
  const extra = paid.gt(open) ? money(paid.minus(open)) : dec(0);
  // Pagamento parcial: o restante continua em aberto (não é desconto)
  // Baixa automática pelo aviso do banco: executada pelo usuário de sistema (auditável), não por uma pessoa
  const ctx = await systemCtx(orgId, ["payment.register", "finance.read"]);
  const s = await settle(ctx, { kind: "RECEIVABLE", titleId: r.id, date: paidAt, principal: principal.toFixed(2), interest: extra.toFixed(2), fine: "0", discount: "0", bankAccountId: c.bankAccountId, idempotencyKey: `charge:${c.id}` });
  await prisma.bankCharge.update({ where: { id: c.id }, data: { status: "PAID", paidAt: new Date(`${paidAt}T00:00:00Z`), paidAmount: paid, settlementId: s.id } });
  await prisma.bankChargeEvent.create({ data: { organizationId: orgId, chargeId: c.id, type: "PAID", payload: { paidAmount: paid.toFixed(2), paidAt, settlement: s.id } } });
  return { ok: true as const, status: 200, settlementId: s.id };
}

/** Webhook do provedor: assinatura obrigatória; eventos normalizados pelo adaptador. */
export async function handleBankingWebhook(providerName: string, rawBody: string, signature: string | null) {
  const p = bankingProvider(providerName);
  if (p.name !== providerName) return { ok: false, status: 404 };
  if (!p.verifyWebhook(rawBody, signature)) return { ok: false, status: 401 };
  let ev;
  try { ev = p.parseWebhook(rawBody); } catch { return { ok: false, status: 400 }; }
  if (!ev) return { ok: false, status: 400 };
  const c = await prisma.bankCharge.findFirst({ where: { provider: p.name, externalId: ev.externalId } });
  if (!c) return { ok: false, status: 404 };
  if (ev.type === "PAID") {
    const r = await applyPayment(c.organizationId, c.id, ev.paidAmount ?? c.amount.toString(), ev.paidAt ?? toCivil(new Date()));
    await auditPlatform(null, "bank_charge.webhook.paid", "BankCharge", c.id, { externalId: ev.externalId, paidAmount: ev.paidAmount }, c.organizationId);
    return r;
  }
  if (c.status === ev.type) return { ok: true, status: 200, duplicate: true };
  if (c.status === "REGISTERED" || c.status === "PENDING") {
    await prisma.bankCharge.update({ where: { id: c.id }, data: { status: ev.type } });
    await prisma.bankChargeEvent.create({ data: { organizationId: c.organizationId, chargeId: c.id, type: ev.type, payload: { externalId: ev.externalId } } });
  }
  return { ok: true, status: 200 };
}

/** Somente no ambiente simulado: registra o pagamento como se o banco tivesse avisado (para testes e demonstração). */
export async function simulatePayment(ctx: Ctx, chargeId: string, paidAmount?: string, paidAt?: string) {
  requirePerm(ctx, "payment.register");
  requireWritable(ctx);
  const c = await ctx.db.bankCharge.findFirst({ where: { id: chargeId } });
  if (!c) throw notFound("Cobrança");
  if (c.environment !== "SIMULATED") throw rule("Pagamento simulado só é permitido para cobranças do ambiente simulado.");
  if (c.status !== "REGISTERED") throw rule("Somente cobrança registrada pode receber pagamento.");
  const r = await applyPayment(ctx.orgId, c.id, paidAmount ?? c.amount.toString(), paidAt ?? todayIn(ctx.timezone));
  await audit(ctx, { action: "bank_charge.simulated_payment", entity: "Receivable", entityId: c.receivableId, companyId: c.companyId, changes: { charge: c.number, paidAmount: paidAmount ?? c.amount.toString() } });
  return r;
}

// ------------------------------------------------------------------ Conciliação automática
export const ruleSchema = z.object({ bankAccountId: zOptId, name: zStr(2), contains: zStr(2), direction: z.enum(["IN", "OUT"]), description: zStr(2), active: zBool });
export async function saveReconciliationRule(ctx: Ctx, i: z.infer<typeof ruleSchema>) {
  requirePerm(ctx, "treasury.manage");
  requireWritable(ctx);
  const r = await ctx.db.reconciliationRule.create({ data: { organizationId: ctx.orgId, bankAccountId: i.bankAccountId ?? null, name: i.name, contains: i.contains, direction: i.direction, description: i.description, active: i.active } });
  await audit(ctx, { action: "reconciliation_rule.create", entity: "ReconciliationRule", entityId: r.id, changes: { contains: i.contains, direction: i.direction } });
  return r;
}
export async function toggleReconciliationRule(ctx: Ctx, id: string) {
  requirePerm(ctx, "treasury.manage");
  requireWritable(ctx);
  const r = await ctx.db.reconciliationRule.findFirst({ where: { id } });
  if (!r) throw notFound("Regra");
  await ctx.db.reconciliationRule.update({ where: { id }, data: { active: !r.active } });
}

/**
 * Concilia automaticamente as linhas pendentes da conta:
 *  1) linha com exatamente UM movimento do livro não conciliado de mesmo valor em ±3 dias → concilia;
 *     (se o mesmo movimento for o único candidato de mais de uma linha, nenhuma delas é conciliada automaticamente)
 *  2) linha sem candidato cuja descrição casa uma regra ativa da conta (ou geral) → lança o movimento e concilia.
 * O que sobrar fica para tratamento manual.
 */
export async function autoReconcile(ctx: Ctx, bankAccountId: string) {
  requirePerm(ctx, "treasury.manage");
  requireWritable(ctx);
  const lines = await ctx.db.bankStatementLine.findMany({ where: { bankAccountId, status: "PENDING" }, orderBy: { date: "asc" } });
  const txs = await ctx.db.bankTransaction.findMany({ where: { bankAccountId, statementLineId: null } });
  const rules = (await ctx.db.reconciliationRule.findMany({ where: { active: true, OR: [{ bankAccountId }, { bankAccountId: null }] } })).sort((a, b) => (a.bankAccountId ? 0 : 1) - (b.bankAccountId ? 0 : 1));
  const candidates = new Map<string, string[]>();
  for (const l of lines) {
    const d = l.date.getTime();
    candidates.set(l.id, txs.filter((t) => dec(t.amount).eq(dec(l.amount)) && Math.abs(t.date.getTime() - d) <= 3 * 86_400_000).map((t) => t.id));
  }
  const usage = new Map<string, number>();
  for (const ids of candidates.values()) if (ids.length === 1) usage.set(ids[0], (usage.get(ids[0]) ?? 0) + 1);
  let matched = 0, byRule = 0;
  for (const l of lines) {
    const ids = candidates.get(l.id) ?? [];
    if (ids.length === 1 && usage.get(ids[0]) === 1) {
      try { await reconcile(ctx, l.id, ids[0]); matched++; } catch { /* concorrência: fica para o manual */ }
      continue;
    }
    if (ids.length) continue;
    const dir = dec(l.amount).lt(0) ? "OUT" : "IN";
    const r = rules.find((x) => x.direction === dir && l.description.toLowerCase().includes(x.contains.toLowerCase()));
    if (r) {
      try { await createFromLine(ctx, l.id, r.description); byRule++; } catch { /* período fechado etc.: manual */ }
    }
  }
  await audit(ctx, { action: "treasury.auto_reconcile", entity: "BankAccount", entityId: bankAccountId, changes: { pending: lines.length, matched, byRule } });
  return { pending: lines.length, matched, byRule, remaining: lines.length - matched - byRule };
}
