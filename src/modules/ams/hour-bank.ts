/**
 * Banco de horas AMS (razão de horas). Créditos: franquia mensal, compra pré-paga, ajuste positivo.
 * Débitos: horas aprovadas do contrato (FIFO por vencimento), ajuste negativo; expiração do saldo vencido; excedente.
 * Toda linha tem chave de idempotência — reprocessar não duplica. A apuração bloqueia o contrato (FOR UPDATE).
 */
import { z } from "zod";
import { requirePerm, requireWritable, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { notify, usersWithPermission } from "@/server/notify";
import { notFound, rule, validation } from "@/lib/errors";
import { zDecimal, zOptDate, zStr } from "@/lib/zod-helpers";
import { addDays, addMonths, civil, monthStart, toCivil, todayIn } from "@/lib/dates";
import { dec, money, qty, sum } from "@/lib/money";
import { consumeFifo, franchiseExpiry, type Credit } from "@/domain/hour-bank";
import type { TenantTx } from "@/server/tenant-db";
import type { HourBankEntry } from "@prisma/client";

const CREDIT_KINDS = ["CREDIT", "ADJUST"];
const isCredit = (e: HourBankEntry) => CREDIT_KINDS.includes(e.kind) && dec(e.hours).gt(0);

function creditsWithRemaining(entries: HourBankEntry[]): (Credit & { entry: HourBankEntry })[] {
  return entries.filter(isCredit).map((c) => ({
    id: c.id, entry: c, validFrom: toCivil(c.month), expiresOn: c.expiresOn ? toCivil(c.expiresOn) : null,
    remaining: dec(c.hours).plus(sum(entries.filter((x) => x.creditEntryId === c.id).map((x) => x.hours))),
  }));
}

async function lockContract(ctx: Ctx, tx: TenantTx, contractId: string) {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Contract" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`, contractId, ctx.orgId);
  if (!rows.length) throw notFound("Contrato");
  return tx.contract.findFirstOrThrow({ where: { id: contractId } });
}

/**
 * Apuração idempotente até `today`: lança franquias mensais devidas, consome horas aprovadas ainda não apropriadas (FIFO),
 * registra excedente conforme a política do contrato e expira saldos vencidos.
 */
export async function syncHourBank(ctx: Ctx, contractId: string, today = todayIn(ctx.timezone)) {
  requirePerm(ctx, "ams.manage");
  requireWritable(ctx);
  return syncHourBankInternal(ctx, contractId, today);
}

/** Apuração sem verificação de permissão: usada como efeito da aprovação de horas (quem aprova não precisa de ams.manage). */
async function syncHourBankInternal(ctx: Ctx, contractId: string, today: string) {
  const result = await ctx.db.$transaction(async (tx) => {
    const c = await lockContract(ctx, tx, contractId);
    if (c.commercialModel !== "AMS_RECURRING") throw rule("Banco de horas aplica-se a contratos AMS.");
    const out = { franchises: 0, debits: 0, overageHours: dec(0), expired: dec(0) };
    // 1) Franquias mensais (do início do contrato até o mês corrente ou o fim do contrato)
    if (c.franchiseHours && dec(c.franchiseHours).gt(0) && c.hourBankPolicy !== "PREPAID") {
      const last = monthStart(c.endDate && toCivil(c.endDate) < today ? toCivil(c.endDate) : today);
      for (let m = monthStart(toCivil(c.startDate)); m <= last; m = addMonths(m, 1)) {
        const key = `FRANCHISE:${c.id}:${m}`;
        if (await tx.hourBankEntry.findFirst({ where: { dedupeKey: key } })) continue;
        const exp = franchiseExpiry(m, c.hourBankPolicy, c.hourBankExpiryMonths);
        await tx.hourBankEntry.create({ data: { organizationId: ctx.orgId, contractId: c.id, month: civil(m), kind: "CREDIT", hours: qty(c.franchiseHours), expiresOn: exp ? civil(exp) : null, sourceType: "MONTHLY_FRANCHISE", notes: `Franquia ${m.slice(0, 7)}`, dedupeKey: key, createdById: ctx.userId } });
        out.franchises++;
      }
    }
    // 2) Consumo FIFO das horas aprovadas ainda não apropriadas (ordem cronológica)
    const done = new Set((await tx.hourBankEntry.findMany({ where: { contractId: c.id, sourceType: "TIME_ENTRY" }, select: { sourceId: true } })).map((x) => x.sourceId));
    const pending = (await tx.timeEntry.findMany({ where: { contractId: c.id, status: "APPROVED", billable: true }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] })).filter((e) => !done.has(e.id));
    let entries = await tx.hourBankEntry.findMany({ where: { contractId: c.id } });
    const overageStatus = c.overagePolicy === "BILL" ? "APPROVED" : c.overagePolicy === "BLOCK" ? "ABSORBED" : "PENDING";
    for (const te of pending) {
      const date = toCivil(te.date);
      if (dec(te.hours).lt(0)) {
        // ajuste negativo de horas: devolve o saldo como crédito com o vencimento da franquia do mês
        const exp = franchiseExpiry(monthStart(date), c.hourBankPolicy, c.hourBankExpiryMonths);
        entries.push(await tx.hourBankEntry.create({ data: { organizationId: ctx.orgId, contractId: c.id, month: civil(monthStart(date)), kind: "ADJUST", hours: dec(te.hours).negated(), expiresOn: exp ? civil(exp) : null, sourceType: "TIME_ENTRY", sourceId: te.id, notes: "Estorno de horas por ajuste de apontamento", dedupeKey: `TIME_ENTRY:${te.id}:CREDIT`, createdById: ctx.userId } }));
        continue;
      }
      const r = consumeFifo(creditsWithRemaining(entries), date, te.hours);
      for (const a of r.allocations) {
        entries.push(await tx.hourBankEntry.create({ data: { organizationId: ctx.orgId, contractId: c.id, month: civil(monthStart(date)), kind: "DEBIT", hours: a.hours.negated(), creditEntryId: a.creditId, sourceType: "TIME_ENTRY", sourceId: te.id, dedupeKey: `TIME_ENTRY:${te.id}:${a.creditId}`, createdById: ctx.userId } }));
        out.debits++;
      }
      if (r.overage.gt(0)) {
        entries.push(await tx.hourBankEntry.create({ data: { organizationId: ctx.orgId, contractId: c.id, month: civil(monthStart(date)), kind: "OVERAGE", hours: r.overage.negated(), sourceType: "TIME_ENTRY", sourceId: te.id, overageStatus, decidedAt: overageStatus === "PENDING" ? null : new Date(), decisionNote: overageStatus === "PENDING" ? null : `Política do contrato: ${c.overagePolicy}`, dedupeKey: `TIME_ENTRY:${te.id}:OVERAGE`, createdById: ctx.userId } }));
        out.overageHours = out.overageHours.plus(r.overage);
      }
    }
    // 3) Expiração de saldos vencidos (após o consumo das horas da competência)
    entries = await tx.hourBankEntry.findMany({ where: { contractId: c.id } });
    for (const cr of creditsWithRemaining(entries)) {
      if (cr.expiresOn && cr.expiresOn < today && dec(cr.remaining).gt(0)) {
        const key = `EXPIRE:${cr.id}`;
        if (await tx.hourBankEntry.findFirst({ where: { dedupeKey: key } })) continue;
        await tx.hourBankEntry.create({ data: { organizationId: ctx.orgId, contractId: c.id, month: civil(monthStart(addDays(cr.expiresOn, 1))), kind: "EXPIRE", hours: dec(cr.remaining).negated(), creditEntryId: cr.id, sourceType: "EXPIRY_RUN", expiresOn: civil(cr.expiresOn), notes: `Saldo vencido em ${cr.expiresOn}`, dedupeKey: key, createdById: ctx.userId } });
        out.expired = out.expired.plus(dec(cr.remaining));
      }
    }
    if (out.franchises || out.debits || out.overageHours.gt(0) || out.expired.gt(0)) await audit(ctx, { action: "hour_bank.sync", entity: "Contract", entityId: c.id, companyId: c.companyId, changes: { franchises: out.franchises, debits: out.debits, overage: out.overageHours.toString(), expired: out.expired.toString() } }, tx);
    return { contract: c, ...out };
  });
  // alertas: excedente aguardando decisão e saldo baixo
  const s = await hourBankSummary(ctx, contractId, today);
  const managers = await usersWithPermission(ctx.orgId, "ams.manage");
  if (result.overageHours.gt(0) && result.contract.overagePolicy === "REQUIRE_APPROVAL") await notify(ctx.orgId, managers, { title: `Excedente de horas aguardando decisão — ${result.contract.number}`, body: `${result.overageHours.toFixed(2)} h`, link: `/app/ams/saldos/${contractId}` });
  if (s.lowBalance && result.debits > 0) await notify(ctx.orgId, managers, { title: `Saldo de horas baixo — ${result.contract.number}`, body: `Disponível ${s.available.toFixed(2)} h`, link: `/app/ams/saldos/${contractId}` });
  return result;
}

/** Contratos AMS afetados por apontamentos aprovados (chamado após a aprovação de horas). */
export async function syncContractsOfEntries(ctx: Ctx, entryIds: string[]) {
  const entries = await ctx.db.timeEntry.findMany({ where: { id: { in: entryIds }, status: "APPROVED", contractId: { not: null } }, select: { contractId: true } });
  const ids = [...new Set(entries.map((e) => e.contractId!))];
  const ams = await ctx.db.contract.findMany({ where: { id: { in: ids }, commercialModel: "AMS_RECURRING" }, select: { id: true } });
  for (const c of ams) await syncHourBankInternal(ctx, c.id, todayIn(ctx.timezone));
}

// ------------------------------------------------------------------ Lançamentos manuais e decisão de excedente
export const manualEntrySchema = z.object({ contractId: z.string(), kind: z.enum(["PREPAID_PURCHASE", "ADJUST"]), hours: zDecimal, expiresOn: zOptDate, notes: zStr(3) });
export async function addManualEntry(ctx: Ctx, i: z.infer<typeof manualEntrySchema>) {
  requirePerm(ctx, "ams.manage");
  requireWritable(ctx);
  const h = qty(i.hours);
  if (h.isZero()) throw validation("Informe as horas.");
  if (i.kind === "PREPAID_PURCHASE" && h.lt(0)) throw validation("Compra pré-paga deve ser positiva.");
  const today = todayIn(ctx.timezone);
  return ctx.db.$transaction(async (tx) => {
    const c = await lockContract(ctx, tx, i.contractId);
    if (c.commercialModel !== "AMS_RECURRING") throw rule("Banco de horas aplica-se a contratos AMS.");
    const month = civil(monthStart(today));
    if (h.gt(0)) {
      const e = await tx.hourBankEntry.create({ data: { organizationId: ctx.orgId, contractId: c.id, month, kind: i.kind === "PREPAID_PURCHASE" ? "CREDIT" : "ADJUST", hours: h, expiresOn: i.expiresOn ? civil(i.expiresOn) : null, sourceType: i.kind === "PREPAID_PURCHASE" ? "PREPAID_PURCHASE" : "MANUAL", notes: i.notes, createdById: ctx.userId } });
      await audit(ctx, { action: "hour_bank.credit", entity: "Contract", entityId: c.id, changes: { kind: i.kind, hours: h.toString() }, reason: i.notes }, tx);
      return e;
    }
    // ajuste negativo consome saldo FIFO; não pode gerar excedente
    const entries = await tx.hourBankEntry.findMany({ where: { contractId: c.id } });
    const r = consumeFifo(creditsWithRemaining(entries), today, h.abs());
    if (r.overage.gt(0)) throw rule("Ajuste maior que o saldo disponível.");
    const stamp = Date.now();
    for (const a of r.allocations) await tx.hourBankEntry.create({ data: { organizationId: ctx.orgId, contractId: c.id, month, kind: "ADJUST", hours: a.hours.negated(), creditEntryId: a.creditId, sourceType: "MANUAL", notes: i.notes, dedupeKey: `ADJUST:${stamp}:${a.creditId}`, createdById: ctx.userId } });
    await audit(ctx, { action: "hour_bank.debit_adjust", entity: "Contract", entityId: c.id, changes: { hours: h.toString() }, reason: i.notes }, tx);
    return null;
  });
}

export async function decideOverage(ctx: Ctx, entryId: string, approve: boolean, note: string) {
  requirePerm(ctx, "ams.manage");
  requireWritable(ctx);
  if (!note.trim()) throw validation("Justifique a decisão.");
  const e = await ctx.db.hourBankEntry.findFirst({ where: { id: entryId } });
  if (!e || e.kind !== "OVERAGE") throw notFound("Excedente");
  if (e.overageStatus !== "PENDING") throw rule("Excedente já decidido.");
  // atualização condicional (concorrência): só decide se ainda estiver pendente
  const r = await ctx.db.hourBankEntry.updateMany({ where: { id: entryId, overageStatus: "PENDING" }, data: { overageStatus: approve ? "APPROVED" : "WAIVED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note } });
  if (!r.count) throw rule("Excedente já decidido.");
  await audit(ctx, { action: approve ? "hour_bank.overage_approved" : "hour_bank.overage_waived", entity: "Contract", entityId: e.contractId, changes: { entryId, hours: e.hours.toString() }, reason: note });
}

// ------------------------------------------------------------------ Consulta
export async function hourBankSummary(ctx: Ctx, contractId: string, today = todayIn(ctx.timezone)) {
  const c = await ctx.db.contract.findFirst({ where: { id: contractId } });
  if (!c) throw notFound("Contrato");
  const entries = await ctx.db.hourBankEntry.findMany({ where: { contractId }, orderBy: [{ month: "asc" }, { createdAt: "asc" }] });
  const credits = creditsWithRemaining(entries);
  const valid = credits.filter((x) => x.validFrom <= today && (x.expiresOn === null || x.expiresOn >= today));
  const available = qty(sum(valid.map((x) => x.remaining)));
  const in30 = addDays(today, 30);
  const expiringSoon = qty(sum(valid.filter((x) => x.expiresOn && x.expiresOn <= in30).map((x) => x.remaining)));
  const m = monthStart(today);
  const monthEntries = entries.filter((e) => toCivil(e.month) === m);
  const consumedMonth = qty(sum(monthEntries.filter((e) => e.kind === "DEBIT").map((e) => dec(e.hours).negated())));
  const overages = entries.filter((e) => e.kind === "OVERAGE");
  const rate = c.overageRate ? dec(c.overageRate) : dec(0);
  const series = new Map<string, { month: string; credited: number; consumed: number; expired: number; overage: number }>();
  for (const e of entries) {
    const k = toCivil(e.month).slice(0, 7);
    const row = series.get(k) ?? { month: k, credited: 0, consumed: 0, expired: 0, overage: 0 };
    const h = Number(e.hours);
    if (isCredit(e)) row.credited += h;
    else if (e.kind === "DEBIT" || (e.kind === "ADJUST" && h < 0)) row.consumed -= h;
    else if (e.kind === "EXPIRE") row.expired -= h;
    else if (e.kind === "OVERAGE") row.overage -= h;
    series.set(k, row);
  }
  const franchise = c.franchiseHours ? dec(c.franchiseHours) : dec(0);
  return {
    contract: c, entries, credits, available, expiringSoon, consumedMonth, franchise,
    lowBalance: franchise.gt(0) && available.lt(franchise.times(c.lowBalancePct).div(100)),
    overagePendingHours: qty(sum(overages.filter((o) => o.overageStatus === "PENDING").map((o) => dec(o.hours).negated()))),
    overageBillableHours: qty(sum(overages.filter((o) => o.overageStatus === "APPROVED").map((o) => dec(o.hours).negated()))),
    overageBillableValue: money(sum(overages.filter((o) => o.overageStatus === "APPROVED").map((o) => dec(o.hours).negated().times(rate)))),
    series: [...series.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}
