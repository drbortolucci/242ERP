/**
 * Motor de aprovações por alçada.
 * - Regras (ApprovalRule) por tipo de documento, empresa, valor, desconto e margem.
 * - Cada regra aplicável gera uma solicitação (ApprovalRequest) com nível e permissão exigida.
 * - Níveis são sequenciais: um nível só pode ser decidido após os anteriores aprovados.
 * - Segregação de funções: quem solicitou não aprova (configurável).
 * - Ao concluir (todas aprovadas) ou rejeitar, o manipulador do documento é chamado na mesma transação.
 */
import { requireWritable, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { getSetting } from "@/server/settings";
import { forbidden, notFound, rule } from "@/lib/errors";
import { dec, type DecimalInput } from "@/lib/money";
import type { TenantTx } from "@/server/tenant-db";

export interface ApprovalFacts {
  companyId?: string | null;
  amount?: DecimalInput;
  discountPct?: DecimalInput;
  marginPct?: DecimalInput | null;
}

export interface MatchedRule {
  ruleId: string;
  level: number;
  requiredPermission: string;
  reason: string;
}

type RuleRow = { id: string; companyId: string | null; name: string; minAmount: unknown; maxDiscountPct: unknown; minMarginPct: unknown; requiredPermission: string; level: number };

/** Avaliação pura das regras (testável sem banco). */
export function matchRules(rules: RuleRow[], f: ApprovalFacts): MatchedRule[] {
  const out: MatchedRule[] = [];
  for (const r of rules) {
    if (r.companyId && f.companyId && r.companyId !== f.companyId) continue;
    const reasons: string[] = [];
    if (r.minAmount !== null && r.minAmount !== undefined && f.amount !== undefined && dec(f.amount).gte(dec(r.minAmount as string))) reasons.push(dec(r.minAmount as string).isZero() ? r.name : `valor ≥ ${dec(r.minAmount as string).toFixed(2)}`);
    if (r.maxDiscountPct !== null && r.maxDiscountPct !== undefined && f.discountPct !== undefined && dec(f.discountPct).gt(dec(r.maxDiscountPct as string))) reasons.push(`desconto ${dec(f.discountPct).toFixed(2)}% > ${dec(r.maxDiscountPct as string).toFixed(2)}%`);
    if (r.minMarginPct !== null && r.minMarginPct !== undefined && f.marginPct !== undefined && f.marginPct !== null && dec(f.marginPct).lt(dec(r.minMarginPct as string))) reasons.push(`margem ${dec(f.marginPct).toFixed(2)}% < ${dec(r.minMarginPct as string).toFixed(2)}%`);
    if (reasons.length) out.push({ ruleId: r.id, level: r.level, requiredPermission: r.requiredPermission, reason: `${r.name}: ${reasons.join(", ")}` });
  }
  return out.sort((a, b) => a.level - b.level);
}

export type ApprovalHandler = {
  onApproved: (ctx: Ctx, tx: TenantTx, entityId: string) => Promise<void>;
  onRejected: (ctx: Ctx, tx: TenantTx, entityId: string, comment: string) => Promise<void>;
  link: (entityId: string) => string;
  label: string;
};
const handlers = new Map<string, ApprovalHandler>();
export function registerApprovalHandler(entity: string, h: ApprovalHandler) {
  handlers.set(entity, h);
}
export function approvalHandler(entity: string) {
  return handlers.get(entity);
}

/**
 * Abre solicitações para o documento. Retorna `approved: true` quando nenhuma regra exige aprovação.
 * Solicitações pendentes anteriores do mesmo documento são canceladas (nova submissão).
 */
export async function openApprovals(ctx: Ctx, tx: TenantTx, args: { docType: string; entity: string; entityId: string; facts: ApprovalFacts }) {
  await tx.approvalRequest.updateMany({ where: { entity: args.entity, entityId: args.entityId, status: "PENDING" }, data: { status: "CANCELED" } });
  const rules = await tx.approvalRule.findMany({ where: { docType: args.docType, active: true } });
  const matched = matchRules(rules as RuleRow[], args.facts);
  for (const m of matched) {
    await tx.approvalRequest.create({
      data: { organizationId: ctx.orgId, companyId: args.facts.companyId ?? null, entity: args.entity, entityId: args.entityId, ruleId: m.ruleId, level: m.level, requiredPermission: m.requiredPermission, reasons: [m.reason], requestedById: ctx.userId },
    });
  }
  return { approved: matched.length === 0, matched };
}

export async function decide(ctx: Ctx, requestId: string, approve: boolean, comment?: string) {
  requireWritable(ctx);
  const sod = await getSetting(ctx, "sod");
  return ctx.db.$transaction(async (tx) => {
    // trava a linha para evitar decisões simultâneas
    const locked = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "ApprovalRequest" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`, requestId, ctx.orgId);
    if (!locked.length) throw notFound("Solicitação de aprovação");
    const req = await tx.approvalRequest.findFirst({ where: { id: requestId } });
    if (!req) throw notFound("Solicitação de aprovação");
    if (req.status !== "PENDING") throw rule("Esta solicitação já foi decidida.");
    if (!ctx.permissions.has(req.requiredPermission)) throw forbidden(`Sua alçada não permite esta aprovação (exige ${req.requiredPermission}).`);
    if (sod.requesterCannotApprove && req.requestedById === ctx.userId) throw forbidden("Segregação de funções: quem solicitou não pode aprovar.");
    if (!approve && !comment?.trim()) throw rule("Informe o motivo da rejeição.");
    const pendingLower = await tx.approvalRequest.count({ where: { entity: req.entity, entityId: req.entityId, status: "PENDING", level: { lt: req.level } } });
    if (pendingLower > 0) throw rule("Há aprovações de nível anterior pendentes.");

    await tx.approvalRequest.update({ where: { id: req.id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: ctx.userId, decidedAt: new Date(), comment: comment ?? null } });
    const h = handlers.get(req.entity);
    if (!approve) {
      await tx.approvalRequest.updateMany({ where: { entity: req.entity, entityId: req.entityId, status: "PENDING" }, data: { status: "CANCELED" } });
      if (h) await h.onRejected(ctx, tx, req.entityId, comment ?? "");
    } else {
      const remaining = await tx.approvalRequest.count({ where: { entity: req.entity, entityId: req.entityId, status: "PENDING" } });
      if (remaining === 0 && h) await h.onApproved(ctx, tx, req.entityId);
    }
    await audit(ctx, { action: approve ? "approval.approve" : "approval.reject", entity: req.entity, entityId: req.entityId, companyId: req.companyId, reason: comment ?? null, changes: { requestId: req.id, level: req.level, reasons: req.reasons } }, tx);
    return req;
  });
}

/** Solicitações que o usuário pode decidir agora. */
export async function pendingForUser(ctx: Ctx) {
  const sod = await getSetting(ctx, "sod");
  const perms = [...ctx.permissions];
  const rows = await ctx.db.approvalRequest.findMany({
    where: { status: "PENDING", requiredPermission: { in: perms }, ...(sod.requesterCannotApprove ? { NOT: { requestedById: ctx.userId } } : {}) },
    orderBy: { createdAt: "asc" }, take: 500,
  });
  // somente o menor nível pendente de cada documento
  const minLevel = new Map<string, number>();
  for (const r of await ctx.db.approvalRequest.findMany({ where: { status: "PENDING", entityId: { in: rows.map((r) => r.entityId) } } })) {
    const k = `${r.entity}:${r.entityId}`;
    minLevel.set(k, Math.min(minLevel.get(k) ?? 99, r.level));
  }
  return rows.filter((r) => r.level === minLevel.get(`${r.entity}:${r.entityId}`));
}

export async function approvalsFor(ctx: Ctx, entity: string, entityId: string) {
  return ctx.db.approvalRequest.findMany({ where: { entity, entityId }, orderBy: [{ createdAt: "desc" }, { level: "asc" }] });
}
