/**
 * Dados de demonstração de cobrança bancária (idempotente: só cria se a organização demo ainda não tiver cobranças).
 * Provedor sempre simulado fora de produção: nenhuma cobrança real é registrada.
 */
import { prisma } from "../src/server/db";
import { buildCtx } from "../src/server/context";
import { issueCharge, simulatePayment, saveReconciliationRule } from "../src/modules/banking/service";

export async function seedBanking() {
  const org = await prisma.organization.findUnique({ where: { slug: "consultoria-demo" } });
  if (!org) return;
  if (await prisma.bankCharge.count({ where: { organizationId: org.id } })) return;
  const finUser = await prisma.user.findUnique({ where: { email: "financeiro@demo.local" } });
  if (!finUser) return;
  const fin = await buildCtx(finUser.id, org.id);
  await saveReconciliationRule(fin, { name: "Tarifas bancárias", contains: "TARIFA", direction: "OUT", description: "Tarifa bancária", active: true });
  await saveReconciliationRule(fin, { name: "Rendimentos", contains: "RENDIMENTO", direction: "IN", description: "Rendimento de aplicação automática", active: true });
  // Títulos em aberto de clientes com CPF/CNPJ: um boleto registrado e um PIX pago (simulação)
  const recs = await prisma.receivable.findMany({ where: { organizationId: org.id, status: "OPEN" }, orderBy: { dueDate: "asc" }, take: 10 });
  const parties = new Map((await prisma.party.findMany({ where: { id: { in: recs.map((r) => r.partyId) } } })).map((p) => [p.id, p]));
  const eligible = recs.filter((r) => parties.get(r.partyId)?.document);
  for (const [idx, r] of eligible.slice(0, 2).entries()) {
    const bank = await prisma.bankAccount.findFirst({ where: { organizationId: org.id, companyId: r.companyId, active: true } });
    if (!bank) continue;
    const ch = await issueCharge(fin, { receivableId: r.id, method: idx === 0 ? "BOLETO" : "PIX", bankAccountId: bank.id, finePct: "2", interestPctMonth: "1" });
    if (idx === 1) await simulatePayment(fin, ch.id);
  }
}
