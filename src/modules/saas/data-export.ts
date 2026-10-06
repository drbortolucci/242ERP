import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { storage } from "@/server/storage";
import { createTenantDb, isTenantModel } from "@/server/tenant-db";
import { requirePerm, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { enqueueAndRun, registerJob } from "@/server/jobs/queue";
import { forbidden, notFound } from "@/lib/errors";

const EXCLUDE = new Set(["Session", "PasswordResetToken", "RateLimitBucket", "ApiKey", "Invitation", "Job"]);

/** Exportação integral dos dados da organização (JSON), via cliente escopado. Senhas/tokens nunca são exportados. */
export async function requestDataExport(ctx: Ctx) {
  requirePerm(ctx, "data.export");
  requirePerm(ctx, "org.manage");
  const exp = await ctx.db.dataExport.create({ data: { organizationId: ctx.orgId, requestedById: ctx.userId } });
  await audit(ctx, { action: "data_export.request", entity: "DataExport", entityId: exp.id });
  await enqueueAndRun("saas.data_export", { exportId: exp.id }, { organizationId: ctx.orgId, createdById: ctx.userId });
  return exp;
}

export async function runDataExport(exportId: string) {
  const exp = await prisma.dataExport.findUniqueOrThrow({ where: { id: exportId } });
  const db = createTenantDb({ orgId: exp.organizationId, companyIds: null });
  const out: Record<string, unknown[]> = {};
  for (const m of Prisma.dmmf.datamodel.models) {
    if (!isTenantModel(m.name) || EXCLUDE.has(m.name)) continue;
    const delegate = (db as unknown as Record<string, { findMany: (a: object) => Promise<unknown[]> }>)[m.name.charAt(0).toLowerCase() + m.name.slice(1)];
    out[m.name] = await delegate.findMany({});
  }
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: exp.organizationId } });
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), organization: { id: org.id, name: org.name, slug: org.slug }, data: out }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 0);
  const key = `${exp.organizationId}/exports/${exp.id}.json`;
  await storage.put(key, Buffer.from(payload, "utf8"));
  await prisma.dataExport.update({ where: { id: exp.id }, data: { status: "READY", storageKey: key, sizeBytes: Buffer.byteLength(payload), readyAt: new Date() } });
  return { tables: Object.keys(out).length };
}

export async function readDataExport(ctx: Ctx, id: string) {
  if (!ctx.permissions.has("data.export")) throw forbidden();
  const exp = await ctx.db.dataExport.findFirst({ where: { id } });
  if (!exp || exp.status !== "READY" || !exp.storageKey) throw notFound("Exportação");
  await audit(ctx, { action: "data_export.download", entity: "DataExport", entityId: id });
  return storage.get(exp.storageKey);
}

registerJob("saas.data_export", async (p) => runDataExport(String(p.exportId)));
