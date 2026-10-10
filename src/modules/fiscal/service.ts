/**
 * Fiscal: regras fiscais de produto (informadas e validadas pelo responsável fiscal), emissão de NF-e de pedidos de
 * venda de produtos pelo provedor configurado, cancelamento e reprocessamento de documentos fiscais (NFS-e e NF-e).
 *
 * O sistema NÃO define CFOP, CST/CSOSN, alíquotas, base de cálculo especial, substituição tributária ou DIFAL: emite
 * somente com regra vigente e validada para cada item e envia os dados ao provedor homologado, que valida junto à
 * SEFAZ/prefeitura. Os valores de tributos exibidos são estimativas com as alíquotas informadas pela empresa.
 */
import { z } from "zod";
import { prisma } from "@/server/db";
import { requirePerm, requireWritable, type Ctx } from "@/server/context";
import { audit, auditPlatform } from "@/server/audit";
import { fiscalProvider, type ProductInvoiceRequest } from "@/server/providers/fiscal";
import { conflict, notFound, rule, validation } from "@/lib/errors";
import { zBool, zDate, zOptDate, zOptDecimal, zOptId, zOptStr, zStr } from "@/lib/zod-helpers";
import { civil, toCivil, todayIn } from "@/lib/dates";
import { dec, money } from "@/lib/money";

// ------------------------------------------------------------------ Regras fiscais de produto
const code = (re: RegExp, msg: string) => zOptStr.refine((v) => !v || re.test(v), msg);
export const productRuleSchema = z.object({
  id: zOptId, companyId: z.string().min(1), name: zStr(3), productId: zOptId, ncm: code(/^\d{8}$/, "NCM com 8 dígitos"),
  cfop: zStr(4).refine((v) => /^\d{4}$/.test(v), "CFOP com 4 dígitos"),
  icmsCst: code(/^\d{2,3}$/, "CST/CSOSN com 2 ou 3 dígitos"), icmsRatePct: zOptDecimal,
  ipiCst: code(/^\d{2}$/, "CST com 2 dígitos"), ipiRatePct: zOptDecimal,
  pisCst: code(/^\d{2}$/, "CST com 2 dígitos"), pisRatePct: zOptDecimal,
  cofinsCst: code(/^\d{2}$/, "CST com 2 dígitos"), cofinsRatePct: zOptDecimal,
  notes: zOptStr, validFrom: zDate, validTo: zOptDate, active: zBool,
});

export async function saveProductRule(ctx: Ctx, i: z.infer<typeof productRuleSchema>) {
  requirePerm(ctx, "fiscal.manage");
  requireWritable(ctx);
  if (!i.productId && !i.ncm) throw validation("Informe o produto ou o NCM ao qual a regra se aplica.");
  // Formato (não conteúdo): a definição dos códigos é do responsável fiscal
  if (!/^\d{4}$/.test(i.cfop)) throw validation("CFOP deve ter 4 dígitos.");
  if (i.ncm && !/^\d{8}$/.test(i.ncm)) throw validation("NCM deve ter 8 dígitos.");
  if (i.icmsCst && !/^\d{2,3}$/.test(i.icmsCst)) throw validation("CST/CSOSN do ICMS deve ter 2 ou 3 dígitos.");
  for (const [k, v] of [["IPI", i.ipiCst], ["PIS", i.pisCst], ["COFINS", i.cofinsCst]] as const) if (v && !/^\d{2}$/.test(v)) throw validation(`CST do ${k} deve ter 2 dígitos.`);
  if (i.validTo && i.validTo < i.validFrom) throw validation("Fim da vigência anterior ao início.");
  for (const v of [i.icmsRatePct, i.ipiRatePct, i.pisRatePct, i.cofinsRatePct]) if (v && (dec(v).lt(0) || dec(v).gt(100))) throw validation("Alíquotas devem estar entre 0% e 100%.");
  if (i.productId && !(await ctx.db.product.findFirst({ where: { id: i.productId } }))) throw validation("Produto inválido.");
  const data = {
    companyId: i.companyId, name: i.name, productId: i.productId ?? null, ncm: i.ncm ?? null, cfop: i.cfop, icmsCst: i.icmsCst ?? null, icmsRatePct: i.icmsRatePct ? dec(i.icmsRatePct) : null,
    ipiCst: i.ipiCst ?? null, ipiRatePct: i.ipiRatePct ? dec(i.ipiRatePct) : null, pisCst: i.pisCst ?? null, pisRatePct: i.pisRatePct ? dec(i.pisRatePct) : null, cofinsCst: i.cofinsCst ?? null, cofinsRatePct: i.cofinsRatePct ? dec(i.cofinsRatePct) : null,
    notes: i.notes ?? null, validFrom: civil(i.validFrom), validTo: i.validTo ? civil(i.validTo) : null, active: i.active,
  };
  if (i.id) {
    const before = await ctx.db.fiscalProductRule.findFirst({ where: { id: i.id } });
    if (!before) throw notFound("Regra fiscal");
    // Qualquer alteração exige nova validação do responsável fiscal
    const r = await ctx.db.fiscalProductRule.update({ where: { id: i.id }, data: { ...data, validatedBy: null, validatedAt: null } });
    await audit(ctx, { action: "fiscal_rule.update", entity: "FiscalProductRule", entityId: r.id, companyId: r.companyId, changes: { cfop: i.cfop, icmsCst: i.icmsCst, icmsRatePct: i.icmsRatePct, revalidationRequired: true } });
    return r;
  }
  const r = await ctx.db.fiscalProductRule.create({ data: { organizationId: ctx.orgId, createdById: ctx.userId, ...data } });
  await audit(ctx, { action: "fiscal_rule.create", entity: "FiscalProductRule", entityId: r.id, companyId: r.companyId, changes: { name: i.name, cfop: i.cfop } });
  return r;
}

export const validateRuleSchema = z.object({ id: z.string().min(1), validatedBy: zStr(3, "Informe o nome e o registro do responsável fiscal") });
/** Registro da validação pelo responsável fiscal (contador/consultor tributário), com nome e data. */
export async function validateProductRule(ctx: Ctx, i: z.infer<typeof validateRuleSchema>) {
  requirePerm(ctx, "fiscal.validate");
  requireWritable(ctx);
  const r = await ctx.db.fiscalProductRule.findFirst({ where: { id: i.id } });
  if (!r) throw notFound("Regra fiscal");
  const u = await ctx.db.fiscalProductRule.update({ where: { id: r.id }, data: { validatedBy: i.validatedBy, validatedAt: new Date() } });
  await audit(ctx, { action: "fiscal_rule.validate", entity: "FiscalProductRule", entityId: r.id, companyId: r.companyId, changes: { validatedBy: i.validatedBy } });
  return u;
}

type Rule = Awaited<ReturnType<typeof prisma.fiscalProductRule.findMany>>[number];
/** Regra aplicável: vigente, ativa e validada; a específica do produto prevalece sobre a do NCM. */
export function pickRule(rules: Rule[], product: { id: string; ncm: string | null }, companyId: string, date: string) {
  const ok = rules.filter((r) => r.active && r.validatedAt && r.companyId === companyId && toCivil(r.validFrom) <= date && (!r.validTo || toCivil(r.validTo) >= date));
  return ok.find((r) => r.productId === product.id) ?? (product.ncm ? ok.find((r) => !r.productId && r.ncm === product.ncm) : undefined) ?? null;
}

/** Estimativa simples (base = valor do item × alíquota informada). Não cobre ST, DIFAL, reduções de base ou benefícios. */
export function estimateTaxes(amount: string | number, r: Pick<Rule, "icmsRatePct" | "ipiRatePct" | "pisRatePct" | "cofinsRatePct">) {
  const pct = (v: unknown) => (v ? money(dec(amount).times(dec(v as string)).div(100)) : dec(0));
  return { icms: pct(r.icmsRatePct), ipi: pct(r.ipiRatePct), pis: pct(r.pisRatePct), cofins: pct(r.cofinsRatePct) };
}

// ------------------------------------------------------------------ NF-e de pedido de venda de produtos
export async function requestProductInvoice(ctx: Ctx, productOrderId: string) {
  requirePerm(ctx, "fiscal.issue");
  requireWritable(ctx);
  const o = await ctx.db.productOrder.findFirst({ where: { id: productOrderId } });
  if (!o) throw notFound("Pedido");
  if (!["CONFIRMED", "DELIVERED"].includes(o.status)) throw rule("A NF-e é emitida para pedido confirmado ou entregue.");
  if (["AUTHORIZED", "PENDING"].includes(o.fiscalStatus)) throw rule("NF-e já autorizada ou em processamento.");
  // Pré-validação: todos os itens precisam de regra fiscal vigente e validada
  const lines = await ctx.db.productOrderLine.findMany({ where: { orderId: o.id } });
  const products = await ctx.db.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } } });
  const rules = await ctx.db.fiscalProductRule.findMany({ where: { companyId: o.companyId } });
  const date = todayIn(ctx.timezone);
  const without = products.filter((p) => !pickRule(rules, p, o.companyId, date)).map((p) => p.code);
  if (without.length) throw rule(`Sem regra fiscal vigente e validada pelo responsável fiscal para: ${without.join(", ")}. Cadastre em Fiscal › Regras de produtos.`);
  const p = fiscalProvider();
  const key = `NFE:${o.id}`;
  const existing = await ctx.db.fiscalDocument.findFirst({ where: { idempotencyKey: key } });
  if (existing && existing.status === "AUTHORIZED") throw conflict("NF-e já autorizada para este pedido.");
  const fd = existing
    ? await ctx.db.fiscalDocument.update({ where: { id: existing.id }, data: { status: "PENDING", lastError: null, provider: p.name, environment: p.environment } })
    : await ctx.db.fiscalDocument.create({ data: { organizationId: ctx.orgId, companyId: o.companyId, docType: "NFE", productOrderId: o.id, provider: p.name, environment: p.environment, idempotencyKey: key } });
  await ctx.db.productOrder.update({ where: { id: o.id }, data: { fiscalStatus: "PENDING" } });
  await audit(ctx, { action: "fiscal.nfe_request", entity: "ProductOrder", entityId: o.id, companyId: o.companyId, changes: { provider: p.name, environment: p.environment } });
  return processProductInvoice(fd.id);
}

export async function processProductInvoice(fiscalDocumentId: string) {
  const fd = await prisma.fiscalDocument.findUnique({ where: { id: fiscalDocumentId } });
  if (!fd || fd.docType !== "NFE" || !fd.productOrderId || !["PENDING", "ERROR"].includes(fd.status)) return fd;
  const o = await prisma.productOrder.findUniqueOrThrow({ where: { id: fd.productOrderId } });
  const [company, party, lines] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: o.companyId } }), prisma.party.findUniqueOrThrow({ where: { id: o.partyId } }), prisma.productOrderLine.findMany({ where: { orderId: o.id } }),
  ]);
  const products = new Map((await prisma.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } } })).map((p) => [p.id, p]));
  const rules = await prisma.fiscalProductRule.findMany({ where: { organizationId: o.organizationId, companyId: o.companyId } });
  const date = toCivil(new Date());
  const items: ProductInvoiceRequest["items"] = lines.map((l) => {
    const p = products.get(l.productId)!;
    const r = pickRule(rules, p, o.companyId, date);
    const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
    return { code: p.code, description: p.name, ncm: p.ncm, cfop: r?.cfop ?? "", unit: p.unit, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), amount: l.amount.toString(), icmsCst: r?.icmsCst ?? null, icmsRatePct: s(r?.icmsRatePct), ipiCst: r?.ipiCst ?? null, ipiRatePct: s(r?.ipiRatePct), pisCst: r?.pisCst ?? null, pisRatePct: s(r?.pisRatePct), cofinsCst: r?.cofinsCst ?? null, cofinsRatePct: s(r?.cofinsRatePct) };
  });
  const req: ProductInvoiceRequest = {
    idempotencyKey: fd.idempotencyKey,
    company: { cnpj: company.cnpj, stateRegistration: company.stateRegistration, taxRegime: company.taxRegime, municipalityCode: company.municipalityCode },
    customer: { name: party.name, document: party.document, email: party.email, address: party.address },
    items, freightAmount: o.freightAmount.toString(), discountAmount: o.discountAmount.toString(), totalAmount: o.totalAmount.toString(),
  };
  try {
    const r = await fiscalProvider().issueProduct(req);
    const status = r.status === "PROCESSING" ? "PROCESSING" : r.status;
    await prisma.$transaction([
      prisma.fiscalDocument.update({ where: { id: fd.id }, data: { status, externalId: r.externalId, number: r.number ?? null, verificationCode: r.verificationCode ?? null, attempts: fd.attempts + 1, lastError: r.message ?? null, requestPayload: req as object, responsePayload: r as object, authorizedAt: status === "AUTHORIZED" ? new Date() : null } }),
      prisma.productOrder.update({ where: { id: o.id }, data: { fiscalStatus: status === "PROCESSING" ? "PENDING" : status } }),
    ]);
    await auditPlatform(null, `fiscal.nfe_${status.toLowerCase()}`, "ProductOrder", o.id, { number: r.number, message: r.message }, o.organizationId);
  } catch (e) {
    await prisma.$transaction([
      prisma.fiscalDocument.update({ where: { id: fd.id }, data: { status: "ERROR", attempts: fd.attempts + 1, lastError: (e as Error).message } }),
      prisma.productOrder.update({ where: { id: o.id }, data: { fiscalStatus: "REJECTED" } }),
    ]);
  }
  return prisma.fiscalDocument.findUnique({ where: { id: fd.id } });
}

// ------------------------------------------------------------------ Cancelamento (NFS-e e NF-e)
export const cancelFiscalSchema = z.object({ id: z.string().min(1), reason: zStr(15, "Justificativa com ao menos 15 caracteres (exigida pelos leiautes de cancelamento)") });
export async function cancelFiscalDocument(ctx: Ctx, i: z.infer<typeof cancelFiscalSchema>) {
  requirePerm(ctx, "fiscal.issue");
  requireWritable(ctx);
  if (i.reason.trim().length < 15) throw validation("Justificativa com ao menos 15 caracteres (exigida pelos leiautes de cancelamento).");
  const fd = await ctx.db.fiscalDocument.findFirst({ where: { id: i.id } });
  if (!fd) throw notFound("Documento fiscal");
  if (fd.status !== "AUTHORIZED") throw rule("Somente documento autorizado pode ser cancelado.");
  const r = await fiscalProvider().cancel(fd.externalId ?? "", i.reason);
  if (!r.ok) throw rule(`Cancelamento recusado pelo provedor: ${r.message ?? "sem detalhe"}. Prazos e condições de cancelamento seguem a legislação aplicável.`);
  await ctx.db.fiscalDocument.update({ where: { id: fd.id }, data: { status: "CANCELED", cancelReason: i.reason, canceledAt: new Date() } });
  if (fd.billingDocumentId) await ctx.db.billingDocument.update({ where: { id: fd.billingDocumentId }, data: { fiscalStatus: "CANCELED" } });
  if (fd.productOrderId) await ctx.db.productOrder.update({ where: { id: fd.productOrderId }, data: { fiscalStatus: "CANCELED" } });
  await audit(ctx, { action: "fiscal.cancel", entity: fd.docType === "NFE" ? "ProductOrder" : "BillingDocument", entityId: fd.productOrderId ?? fd.billingDocumentId ?? fd.id, companyId: fd.companyId, changes: { number: fd.number }, reason: i.reason });
}

/** Reprocessa documento rejeitado/com erro (após corrigir cadastro, regra ou código de serviço). */
export async function retryFiscalDocument(ctx: Ctx, id: string) {
  requirePerm(ctx, "fiscal.issue");
  requireWritable(ctx);
  const fd = await ctx.db.fiscalDocument.findFirst({ where: { id } });
  if (!fd) throw notFound("Documento fiscal");
  if (!["REJECTED", "ERROR", "PENDING"].includes(fd.status)) throw rule("Somente documento rejeitado, com erro ou pendente pode ser reprocessado.");
  if (fd.docType === "NFE" && fd.productOrderId) {
    await ctx.db.productOrder.update({ where: { id: fd.productOrderId }, data: { fiscalStatus: "NOT_REQUESTED" } });
    return requestProductInvoice(ctx, fd.productOrderId);
  }
  const { requestFiscalDocument } = await import("@/modules/billing/fiscal");
  await ctx.db.billingDocument.update({ where: { id: fd.billingDocumentId! }, data: { fiscalStatus: "REJECTED" } });
  return requestFiscalDocument(ctx, fd.billingDocumentId!);
}

export async function fiscalSummary(ctx: Ctx) {
  requirePerm(ctx, "fiscal.read");
  const rows = await ctx.db.fiscalDocument.groupBy({ by: ["docType", "status"], _count: true });
  return rows.map((r) => ({ docType: r.docType, status: r.status, count: r._count }));
}

