/**
 * Solicitação de NFS-e para um documento de cobrança: registro idempotente (FiscalDocument), processamento em tarefa
 * com tentativas, e webhook autenticado para provedores assíncronos. Em desenvolvimento o provedor é simulado.
 */
import { prisma } from "@/server/db";
import { requirePerm, requireWritable, type Ctx } from "@/server/context";
import { audit, auditPlatform } from "@/server/audit";
import { enqueue, registerJob } from "@/server/jobs/queue";
import { fiscalProvider } from "@/server/providers/fiscal";
import { notFound, rule } from "@/lib/errors";
import { toCivil } from "@/lib/dates";

export async function requestFiscalDocument(ctx: Ctx, billingDocumentId: string) {
  requirePerm(ctx, "billing.issue");
  requireWritable(ctx);
  const d = await ctx.db.billingDocument.findFirst({ where: { id: billingDocumentId } });
  if (!d) throw notFound("Documento");
  if (d.status !== "ISSUED") throw rule("Documento cancelado.");
  if (d.fiscalStatus === "AUTHORIZED" || d.fiscalStatus === "PENDING") throw rule("NFS-e já autorizada ou em processamento.");
  const p = fiscalProvider();
  const key = `NFSE:${d.id}`;
  const existing = await ctx.db.fiscalDocument.findFirst({ where: { idempotencyKey: key } });
  const fd = existing
    ? await ctx.db.fiscalDocument.update({ where: { id: existing.id }, data: { status: "PENDING", lastError: null, provider: p.name, environment: p.environment } })
    : await ctx.db.fiscalDocument.create({ data: { organizationId: ctx.orgId, companyId: d.companyId, billingDocumentId: d.id, provider: p.name, environment: p.environment, idempotencyKey: key } });
  await ctx.db.billingDocument.update({ where: { id: d.id }, data: { fiscalStatus: "PENDING" } });
  await audit(ctx, { action: "fiscal.request", entity: "BillingDocument", entityId: d.id, changes: { provider: p.name, environment: p.environment } });
  await enqueue("fiscal.issue", { fiscalDocumentId: fd.id }, { organizationId: ctx.orgId, uniqueKey: `fiscal:${fd.id}:${fd.attempts}`, createdById: ctx.userId });
  // Processa já (ambientes sem processador de tarefas, como a homologação serverless); em falha transitória a tarefa refaz
  try { return (await processFiscalDocument(fd.id)) ?? fd; } catch { return fd; }
}

/** Processa a emissão (tarefa). Erros transitórios contam tentativa; rejeição é registrada para correção. */
export async function processFiscalDocument(fiscalDocumentId: string) {
  const fd = await prisma.fiscalDocument.findUnique({ where: { id: fiscalDocumentId } });
  if (!fd || !["PENDING", "ERROR"].includes(fd.status)) return fd;
  if (fd.docType === "NFE") {
    const { processProductInvoice } = await import("@/modules/fiscal/service");
    return processProductInvoice(fd.id);
  }
  if (!fd.billingDocumentId) return fd;
  const d = await prisma.billingDocument.findUniqueOrThrow({ where: { id: fd.billingDocumentId } });
  const [company, party, items] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: d.companyId } }),
    prisma.party.findUniqueOrThrow({ where: { id: d.partyId } }),
    prisma.measurementItem.findMany({ where: { billingDocumentId: d.id } }),
  ]);
  const issueDate = toCivil(d.issueDate);
  const codes = await prisma.fiscalServiceCode.findMany({ where: { organizationId: d.organizationId, companyId: d.companyId, validFrom: { lte: d.issueDate }, OR: [{ validTo: null }, { validTo: { gte: d.issueDate } }] } });
  // Código de serviço: do serviço do item; sem serviço, o primeiro código vigente da empresa (validado pelo responsável fiscal)
  const codeFor = (serviceId: string | null) => (codes.find((c) => c.serviceId === serviceId) ?? codes[0])?.serviceCode ?? "";
  const req = {
    idempotencyKey: fd.idempotencyKey,
    company: { cnpj: company.cnpj, municipalRegistration: company.municipalRegistration, municipalityCode: company.municipalityCode },
    customer: { name: party.name, document: party.document },
    services: items.map((i) => ({ serviceCode: codeFor(i.serviceId), description: i.description, amount: i.amount.toString() })),
    grossAmount: d.grossAmount.toString(),
    withholdings: (d.withholdings as { code: string; amount: string }[]).map((w) => ({ code: w.code, amount: w.amount })),
  };
  try {
    const r = await fiscalProvider().issue(req);
    const status = r.status === "PROCESSING" ? "PROCESSING" : r.status;
    await prisma.$transaction([
      prisma.fiscalDocument.update({ where: { id: fd.id }, data: { status, externalId: r.externalId, number: r.number ?? null, verificationCode: r.verificationCode ?? null, attempts: fd.attempts + 1, lastError: r.message ?? null, requestPayload: req, responsePayload: r as object, authorizedAt: status === "AUTHORIZED" ? new Date() : null } }),
      prisma.billingDocument.update({ where: { id: d.id }, data: { fiscalStatus: status === "PROCESSING" ? "PENDING" : status } }),
    ]);
    await auditPlatform(null, `fiscal.${status.toLowerCase()}`, "BillingDocument", d.id, { number: r.number, issueDate, message: r.message }, d.organizationId);
  } catch (e) {
    await prisma.fiscalDocument.update({ where: { id: fd.id }, data: { status: "ERROR", attempts: fd.attempts + 1, lastError: (e as Error).message } });
    throw e; // a fila aplica nova tentativa
  }
  return prisma.fiscalDocument.findUnique({ where: { id: fd.id } });
}

registerJob("fiscal.issue", async (payload) => processFiscalDocument(String(payload.fiscalDocumentId)));

/** Webhook do provedor fiscal: autenticado (HMAC) e idempotente por (externalId, status). */
export async function handleFiscalWebhook(rawBody: string, signature: string | null) {
  const p = fiscalProvider();
  if (!p.verifyWebhook(rawBody, signature)) return { ok: false, status: 401 };
  const body = JSON.parse(rawBody) as { externalId?: string; status?: string; number?: string; verificationCode?: string; message?: string };
  if (!body.externalId || !["AUTHORIZED", "REJECTED", "CANCELED"].includes(body.status ?? "")) return { ok: false, status: 400 };
  const fd = await prisma.fiscalDocument.findFirst({ where: { externalId: body.externalId } });
  if (!fd) return { ok: false, status: 404 };
  if (fd.status === body.status) return { ok: true, status: 200, duplicate: true };
  await prisma.$transaction([
    prisma.fiscalDocument.update({ where: { id: fd.id }, data: { status: body.status, number: body.number ?? fd.number, verificationCode: body.verificationCode ?? fd.verificationCode, lastError: body.message ?? null, authorizedAt: body.status === "AUTHORIZED" ? new Date() : fd.authorizedAt } }),
    ...(fd.billingDocumentId ? [prisma.billingDocument.update({ where: { id: fd.billingDocumentId }, data: { fiscalStatus: body.status! } })] : []),
    ...(fd.productOrderId ? [prisma.productOrder.update({ where: { id: fd.productOrderId }, data: { fiscalStatus: body.status! } })] : []),
  ]);
  await auditPlatform(null, `fiscal.webhook.${body.status!.toLowerCase()}`, fd.docType === "NFE" ? "ProductOrder" : "BillingDocument", fd.productOrderId ?? fd.billingDocumentId, { externalId: body.externalId }, fd.organizationId);
  return { ok: true, status: 200 };
}
