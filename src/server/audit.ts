import { prisma } from "./db";
import type { Ctx } from "./context";

const SENSITIVE = /pass|token|secret|hash|mfa|cvv|card/i;

function sanitize(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(sanitize);
  if (typeof v === "object") {
    if (typeof (v as { toFixed?: unknown }).toFixed === "function" && typeof (v as { d?: unknown }).d !== "undefined") return String(v);
    if (v instanceof Date) return v.toISOString();
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = SENSITIVE.test(k) ? "[redacted]" : sanitize(val);
    return out;
  }
  if (typeof v === "bigint") return v.toString();
  return v;
}

export interface AuditInput {
  action: string;
  entity: string;
  entityId?: string | null;
  companyId?: string | null;
  changes?: unknown;
  reason?: string | null;
}

type AuditWriter = { auditLog: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> } };

/** Registra auditoria. Passe `tx` (cliente transacional) para gravar na mesma transação da operação. */
export async function audit(ctx: Pick<Ctx, "orgId" | "userId" | "userName" | "correlationId" | "support">, input: AuditInput, tx?: unknown) {
  const data = {
    organizationId: ctx.orgId,
    companyId: input.companyId ?? null,
    userId: ctx.userId,
    actorLabel: ctx.support ? `suporte:${ctx.userName}` : ctx.userName,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId ?? null,
    changes: (sanitize(input.changes) ?? undefined) as object | undefined,
    reason: input.reason ?? null,
    correlationId: ctx.correlationId,
  };
  const writer = (tx ?? prisma) as AuditWriter;
  await writer.auditLog.create({ data });
}

/** Auditoria de plataforma (sem tenant). */
export async function auditPlatform(userId: string | null, action: string, entity: string, entityId: string | null, changes?: unknown, organizationId?: string | null) {
  await prisma.auditLog.create({
    data: { organizationId: organizationId ?? null, userId, action, entity, entityId, changes: (sanitize(changes) ?? undefined) as object | undefined },
  });
}

/** Diferença simples entre dois objetos (somente campos alterados). */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    const a = before[k];
    const b = after[k];
    if (String(a ?? "") !== String(b ?? "")) out[k] = { from: a, to: b };
  }
  return out;
}
