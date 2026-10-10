/**
 * Dados de demonstração do módulo fiscal (idempotente). As regras usam valores FICTÍCIOS, identificados como tais:
 * não representam orientação fiscal e não devem ser copiadas para uso real.
 */
import { prisma } from "../src/server/db";
import { buildCtx } from "../src/server/context";
import { saveProductRule, validateProductRule, requestProductInvoice } from "../src/modules/fiscal/service";

export async function seedFiscal(passwordHash: string) {
  const org = await prisma.organization.findUnique({ where: { slug: "consultoria-demo" } });
  if (!org) return;
  if (await prisma.fiscalProductRule.count({ where: { organizationId: org.id } })) return;
  const role = await prisma.role.findFirst({ where: { organizationId: org.id, key: "fiscal" } });
  if (!role) return;
  const user = await prisma.user.upsert({ where: { email: "fiscal@demo.local" }, create: { email: "fiscal@demo.local", name: "Fábio Fiscal", passwordHash }, update: {} });
  if (!(await prisma.membership.findFirst({ where: { userId: user.id, organizationId: org.id } }))) {
    await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, roleIds: [role.id], allCompanies: true, companyIds: [], kind: "INTERNAL" } });
  }
  const ctx = await buildCtx(user.id, org.id);
  const company = await prisma.company.findFirst({ where: { organizationId: org.id, kind: "HEADQUARTERS" }, orderBy: { createdAt: "asc" } });
  const products = await prisma.product.findMany({ where: { organizationId: org.id }, orderBy: { code: "asc" } });
  if (!company || !products.length) return;
  const notes = "DEMONSTRAÇÃO: valores fictícios, sem validade fiscal. Substitua pelos definidos pelo responsável fiscal da empresa.";
  for (const p of products) {
    const r = await saveProductRule(ctx, { companyId: company.id, name: `Exemplo — ${p.code}`, productId: p.id, cfop: "5102", icmsCst: "00", icmsRatePct: "18", pisCst: "01", pisRatePct: "1.65", cofinsCst: "01", cofinsRatePct: "7.6", notes, validFrom: `${new Date().getUTCFullYear()}-01-01`, active: true });
    // uma regra fica aguardando validação, para demonstrar o bloqueio da emissão
    if (p.code !== "KIT-TRN") await validateProductRule(ctx, { id: r.id, validatedBy: "Demonstração (sem validade fiscal)" });
  }
  // NF-e simulada do pedido já entregue, se todos os seus itens tiverem regra validada
  const delivered = await prisma.productOrder.findFirst({ where: { organizationId: org.id, status: "DELIVERED", fiscalStatus: "NOT_REQUESTED" } });
  if (delivered) await requestProductInvoice(ctx, delivered.id).catch(() => undefined);
}
