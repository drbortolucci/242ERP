/**
 * Dados de demonstração da contabilidade (idempotente): usuário contador, plano de contas sugerido e contabilização
 * dos meses com operações (meses fechados são mantidos como estão).
 */
import { prisma } from "../src/server/db";
import { buildCtx } from "../src/server/context";
import { ensureSuggestedChart, syncJournal } from "../src/modules/accounting/service";
import { addMonths, monthStart, toCivil } from "../src/lib/dates";

export async function seedAccounting(passwordHash: string) {
  const org = await prisma.organization.findUnique({ where: { slug: "consultoria-demo" } });
  if (!org) return;
  const role = await prisma.role.findFirst({ where: { organizationId: org.id, key: "accountant" } });
  if (!role) return;
  const user = await prisma.user.upsert({ where: { email: "contador@demo.local" }, create: { email: "contador@demo.local", name: "Carla Contadora", passwordHash }, update: {} });
  if (!(await prisma.membership.findFirst({ where: { userId: user.id, organizationId: org.id } }))) {
    await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, roleIds: [role.id], allCompanies: true, companyIds: [], kind: "INTERNAL" } });
  }
  if (await prisma.journalEntry.count({ where: { organizationId: org.id } })) return;
  const admin = await prisma.user.findUnique({ where: { email: "admin@demo.local" } });
  if (!admin) return;
  const ctx = await buildCtx(admin.id, org.id);
  await ensureSuggestedChart(ctx);
  const companies = await prisma.company.findMany({ where: { organizationId: org.id } });
  const first = await prisma.bankAccount.findFirst({ where: { organizationId: org.id }, orderBy: { openingDate: "asc" } });
  const start = monthStart(toCivil(first?.openingDate ?? new Date()));
  const end = monthStart(toCivil(new Date()));
  for (const c of companies) {
    for (let m = start; m <= end; m = addMonths(m, 1)) {
      await syncJournal(ctx, c.id, m).catch(() => undefined); // mês fechado: permanece como está
    }
  }
}
