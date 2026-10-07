/**
 * API pública (REST/JSON) por chave de API: a chave é exibida uma única vez e armazenada apenas como hash (SHA-256);
 * escopos limitam recursos e operações; limite de taxa por chave; toda escrita é auditada com a chave como ator.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/server/db";
import { requirePerm, requireWritable, systemCtx, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { rateLimit } from "@/server/auth/rate-limit";
import { sha256 } from "@/server/auth/crypto";
import { AppError, forbidden, notFound, validation } from "@/lib/errors";
import { openTicket, ticketSchema } from "../ams/tickets";
import type { Permission } from "@/lib/permissions";

export const API_SCOPES = {
  "read:parties": { label: "Ler clientes e fornecedores", perms: ["master.read"] },
  "read:contracts": { label: "Ler contratos", perms: ["contract.read"] },
  "read:projects": { label: "Ler projetos", perms: ["project.read"] },
  "read:tickets": { label: "Ler chamados", perms: ["ams.read"] },
  "write:tickets": { label: "Abrir chamados", perms: ["ams.read", "ams.write"] },
  "read:receivables": { label: "Ler títulos a receber", perms: ["finance.read"] },
} as const satisfies Record<string, { label: string; perms: Permission[] }>;
export type ApiScope = keyof typeof API_SCOPES;

export const apiKeySchema = z.object({ name: z.string().trim().min(3), scopes: z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.enum(Object.keys(API_SCOPES) as [ApiScope, ...ApiScope[]])).min(1, "Selecione ao menos um escopo")) });

export async function createApiKey(ctx: Ctx, i: z.infer<typeof apiKeySchema>) {
  requirePerm(ctx, "settings.manage");
  requireWritable(ctx);
  if (!ctx.planModules.includes("api")) throw forbidden("A API não está incluída no plano da organização.");
  // A chave opera em todas as empresas da organização: só quem tem esse alcance pode criá-la, e apenas com permissões que já possui.
  if (ctx.kind !== "INTERNAL" || ctx.companyIds !== null) throw forbidden("Chaves de API exigem administrador com acesso a todas as empresas.");
  const missing = [...new Set(i.scopes.flatMap((s) => API_SCOPES[s].perms as readonly string[]))].filter((p) => !ctx.permissions.has(p));
  if (missing.length) throw forbidden(`Você não possui as permissões exigidas pelos escopos: ${missing.join(", ")}.`);
  const prefix = randomBytes(4).toString("hex");
  const secret = `erp_${prefix}_${randomBytes(24).toString("base64url")}`;
  const k = await ctx.db.apiKey.create({ data: { organizationId: ctx.orgId, name: i.name, prefix, keyHash: sha256(secret), scopes: i.scopes, createdById: ctx.userId } });
  await audit(ctx, { action: "api_key.create", entity: "ApiKey", entityId: k.id, changes: { name: i.name, scopes: i.scopes, prefix } });
  return { key: k, secret }; // o segredo não é armazenado e não pode ser recuperado
}

export async function revokeApiKey(ctx: Ctx, id: string) {
  requirePerm(ctx, "settings.manage");
  requireWritable(ctx);
  const r = await ctx.db.apiKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!r.count) throw notFound("Chave");
  await audit(ctx, { action: "api_key.revoke", entity: "ApiKey", entityId: id });
}

/** Autentica o cabeçalho Authorization: Bearer <chave> e devolve um contexto com as permissões dos escopos. */
export async function apiContext(authorization: string | null) {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  if (!token || !/^erp_[0-9a-f]{8}_/.test(token)) throw new AppError("UNAUTHENTICATED", "Chave de API ausente ou inválida.");
  const k = await prisma.apiKey.findUnique({ where: { keyHash: sha256(token) } });
  if (!k || k.revokedAt) throw new AppError("UNAUTHENTICATED", "Chave de API ausente ou inválida.");
  // Chave deixa de valer se quem a criou perdeu o acesso à organização.
  const creator = await prisma.membership.findUnique({ where: { userId_organizationId: { userId: k.createdById, organizationId: k.organizationId } } });
  if (!creator?.active) throw new AppError("UNAUTHENTICATED", "Chave de API inativa: o responsável não tem mais acesso à organização.");
  await rateLimit(`api:${k.id}`, Number(process.env.API_RATE_LIMIT_PER_MIN ?? 600), 60);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: k.organizationId }, include: { plan: true } });
  if (!org.plan.modules.includes("api")) throw forbidden("A API não está incluída no plano da organização.");
  const perms = [...new Set(k.scopes.flatMap((s) => (API_SCOPES[s as ApiScope]?.perms ?? []) as readonly Permission[]))];
  const ctx = await systemCtx(k.organizationId, perms);
  await prisma.apiKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } });
  return { ctx: { ...ctx, userId: `api:${k.id}`, userName: `API: ${k.name}` } as Ctx, scopes: k.scopes, keyId: k.id };
}

const page = (u: URL) => {
  const limit = Math.min(100, Math.max(1, Number(u.searchParams.get("limit") ?? 50)));
  const p = Math.max(1, Number(u.searchParams.get("page") ?? 1));
  const since = u.searchParams.get("updatedSince");
  const sinceDate = since ? new Date(since) : null;
  if (sinceDate && Number.isNaN(sinceDate.getTime())) throw validation("updatedSince inválido (use ISO 8601).");
  return { take: limit, skip: (p - 1) * limit, page: p, limit, since: sinceDate };
};
const needScope = (scopes: string[], s: ApiScope) => { if (!scopes.includes(s)) throw forbidden(`Escopo necessário: ${s}.`); };

/** Leitura paginada de um recurso. Campos explícitos (sem custos/margens). */
export async function apiList(resource: string, authorization: string | null, url: string) {
  const { ctx, scopes } = await apiContext(authorization);
  const u = new URL(url);
  const pg = page(u);
  const upd = pg.since ? { updatedAt: { gte: pg.since } } : {};
  switch (resource) {
    case "clientes": {
      needScope(scopes, "read:parties");
      const where = { OR: [{ isCustomer: true }, { isProspect: true }], ...upd };
      const [data, total] = await Promise.all([ctx.db.party.findMany({ where, orderBy: { name: "asc" }, skip: pg.skip, take: pg.take, select: { id: true, name: true, tradeName: true, document: true, email: true, phone: true, isCustomer: true, isProspect: true, active: true, updatedAt: true } }), ctx.db.party.count({ where })]);
      return { data, page: pg.page, limit: pg.limit, total };
    }
    case "contratos": {
      needScope(scopes, "read:contracts");
      const [data, total] = await Promise.all([ctx.db.contract.findMany({ where: upd, orderBy: { number: "asc" }, skip: pg.skip, take: pg.take, select: { id: true, number: true, partyId: true, companyId: true, title: true, commercialModel: true, status: true, startDate: true, endDate: true, totalValue: true, updatedAt: true } }), ctx.db.contract.count({ where: upd })]);
      return { data, page: pg.page, limit: pg.limit, total };
    }
    case "projetos": {
      needScope(scopes, "read:projects");
      const [data, total] = await Promise.all([ctx.db.project.findMany({ where: upd, orderBy: { code: "asc" }, skip: pg.skip, take: pg.take, select: { id: true, code: true, name: true, partyId: true, contractId: true, status: true, plannedStart: true, plannedEnd: true, updatedAt: true } }), ctx.db.project.count({ where: upd })]);
      return { data, page: pg.page, limit: pg.limit, total };
    }
    case "chamados": {
      needScope(scopes, "read:tickets");
      const [data, total] = await Promise.all([ctx.db.ticket.findMany({ where: upd, orderBy: { openedAt: "desc" }, skip: pg.skip, take: pg.take, select: { id: true, number: true, partyId: true, contractId: true, type: true, priority: true, status: true, title: true, openedAt: true, responseDueAt: true, resolutionDueAt: true, resolvedAt: true, responseBreached: true, resolutionBreached: true, updatedAt: true } }), ctx.db.ticket.count({ where: upd })]);
      return { data, page: pg.page, limit: pg.limit, total };
    }
    case "titulos-receber": {
      needScope(scopes, "read:receivables");
      const [data, total] = await Promise.all([ctx.db.receivable.findMany({ where: upd, orderBy: { dueDate: "asc" }, skip: pg.skip, take: pg.take, select: { id: true, number: true, partyId: true, billingDocumentId: true, installment: true, installments: true, issueDate: true, dueDate: true, amount: true, openAmount: true, status: true, updatedAt: true } }), ctx.db.receivable.count({ where: upd })]);
      return { data, page: pg.page, limit: pg.limit, total };
    }
    default:
      throw notFound("Recurso");
  }
}

/** Criação via API (apenas chamados nesta versão). */
export async function apiCreate(resource: string, authorization: string | null, body: unknown) {
  const { ctx, scopes } = await apiContext(authorization);
  if (resource !== "chamados") throw notFound("Recurso");
  needScope(scopes, "write:tickets");
  const parsed = ticketSchema.safeParse(body);
  if (!parsed.success) throw validation("Dados inválidos: " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const t = await openTicket(ctx, parsed.data);
  return { id: t.id, number: t.number, priority: t.priority, responseDueAt: t.responseDueAt, resolutionDueAt: t.resolutionDueAt };
}
