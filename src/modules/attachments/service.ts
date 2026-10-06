import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import { storage } from "@/server/storage";
import { audit } from "@/server/audit";
import { requireWritable, type Ctx } from "@/server/context";
import { forbidden, notFound, validation } from "@/lib/errors";
import { assertStorageLimit } from "../saas/limits";
import { sniffFile, ALLOWED_DESCRIPTION } from "./sniff";

const maxBytes = () => Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024;

/** Entidades que aceitam anexos e a permissão necessária para anexar/ler. */
const ENTITY_PERMS: Record<string, { read: string[]; write: string[] }> = {
  Company: { read: ["company.manage", "master.read"], write: ["company.manage"] },
  Party: { read: ["master.read"], write: ["master.write"] },
  Opportunity: { read: ["crm.read"], write: ["crm.write"] },
  Proposal: { read: ["crm.read"], write: ["proposal.write"] },
  Contract: { read: ["contract.read"], write: ["contract.write"] },
  Project: { read: ["project.read"], write: ["project.write"] },
  Professional: { read: ["cost.view", "resource.write"], write: ["resource.write", "master.write"] },
  Expense: { read: ["expense.write", "expense.approve", "finance.read"], write: ["expense.write"] },
  PurchaseOrder: { read: ["purchase.write", "purchase.approve", "finance.read"], write: ["purchase.write", "purchase.receive"] },
  SupplierInvoice: { read: ["purchase.write", "finance.read"], write: ["purchase.write", "finance.write"] },
  Ticket: { read: ["ams.read"], write: ["ams.write"] },
  Measurement: { read: ["billing.read"], write: ["billing.measure"] },
  BillingDocument: { read: ["billing.read"], write: ["billing.issue"] },
  Payable: { read: ["finance.read"], write: ["finance.write"] },
  Receivable: { read: ["finance.read"], write: ["finance.write"] },
};

function hasAny(ctx: Ctx, perms: string[]) {
  return perms.some((p) => ctx.permissions.has(p));
}

export interface UploadInput {
  entity: string;
  entityId: string;
  fileName: string;
  data: Buffer;
  visibility?: "INTERNAL" | "CLIENT" | "RESTRICTED";
  companyId?: string | null;
}

export async function uploadAttachment(ctx: Ctx, input: UploadInput) {
  requireWritable(ctx);
  const rule = ENTITY_PERMS[input.entity];
  if (!rule) throw validation("Tipo de anexo não suportado.");
  // Portal do cliente pode anexar somente em chamados próprios
  const portalTicket = ctx.kind === "CLIENT" && input.entity === "Ticket";
  if (!portalTicket && !hasAny(ctx, rule.write)) throw forbidden();
  if (input.data.length === 0) throw validation("Arquivo vazio.");
  if (input.data.length > maxBytes()) throw validation(`Arquivo excede o limite de ${process.env.MAX_UPLOAD_MB ?? 10} MB.`);
  const sniffed = sniffFile(input.data, input.fileName);
  if (!sniffed) throw validation(`Tipo de arquivo não permitido. Aceitos: ${ALLOWED_DESCRIPTION}.`);
  await assertStorageLimit(ctx.orgId, input.data.length);
  await assertEntityAccess(ctx, input.entity, input.entityId);

  const sha256 = createHash("sha256").update(input.data).digest("hex");
  const key = `${ctx.orgId}/${input.entity}/${randomUUID()}.${sniffed.ext}`;
  await storage.put(key, input.data);
  const safeName = input.fileName.replace(/[^\w.\-() À-ÿ]/g, "_").slice(0, 150);
  const att = await ctx.db.attachment.create({
    data: {
      organizationId: ctx.orgId, companyId: input.companyId ?? null, entity: input.entity, entityId: input.entityId, fileName: safeName,
      mimeType: sniffed.mime, sizeBytes: input.data.length, sha256, storageKey: key, visibility: portalTicket ? "CLIENT" : input.visibility ?? "INTERNAL", uploadedById: ctx.userId,
    },
  });
  await prisma.organization.update({ where: { id: ctx.orgId }, data: { storageUsedBytes: { increment: input.data.length } } });
  await audit(ctx, { action: "attachment.upload", entity: input.entity, entityId: input.entityId, changes: { file: safeName, size: input.data.length, mime: sniffed.mime } });
  return att;
}

/** Verifica se o registro pai existe no tenant (e, no portal, pertence ao cliente). */
async function assertEntityAccess(ctx: Ctx, entity: string, entityId: string) {
  const model = entity.charAt(0).toLowerCase() + entity.slice(1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parent = await (ctx.db as any)[model]?.findFirst({ where: { id: entityId } });
  if (!parent) throw notFound("Registro do anexo");
  if (ctx.kind === "CLIENT" && parent.partyId !== ctx.partyId) throw forbidden();
}

export async function listAttachments(ctx: Ctx, entity: string, entityId: string) {
  const rule = ENTITY_PERMS[entity];
  if (ctx.kind === "CLIENT") {
    await assertEntityAccess(ctx, entity, entityId);
    return ctx.db.attachment.findMany({ where: { entity, entityId, visibility: "CLIENT" }, orderBy: { createdAt: "desc" } });
  }
  if (!rule || !hasAny(ctx, rule.read)) return [];
  const restricted = hasAny(ctx, ["cost.view"]) ? {} : { visibility: { not: "RESTRICTED" } };
  return ctx.db.attachment.findMany({ where: { entity, entityId, ...restricted }, orderBy: { createdAt: "desc" } });
}

export async function readAttachment(ctx: Ctx, id: string) {
  const att = await ctx.db.attachment.findFirst({ where: { id } });
  if (!att) throw notFound("Anexo");
  if (ctx.kind === "CLIENT") {
    if (att.visibility !== "CLIENT") throw forbidden();
    await assertEntityAccess(ctx, att.entity, att.entityId);
  } else {
    const rule = ENTITY_PERMS[att.entity];
    if (!rule || !hasAny(ctx, rule.read)) throw forbidden();
    if (att.visibility === "RESTRICTED" && !ctx.permissions.has("cost.view")) throw forbidden();
  }
  const data = await storage.get(att.storageKey);
  return { att, data };
}
