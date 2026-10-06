/**
 * Dados de demonstração — gerados por meio dos MESMOS serviços da aplicação (sem números fixos).
 * Credenciais exclusivas do ambiente local. Nunca reutilize em produção.
 */
import { prisma } from "../src/server/db";
import { ensurePlans } from "../src/modules/saas/plans";
import { hashPassword } from "../src/server/auth/crypto";
import { seedDemo } from "./seed-demo";

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "Demo@2026local";

async function main() {
  if (process.env.APP_ENV === "production") throw new Error("Seed de demonstração não pode ser executado em produção.");
  await ensurePlans();
  const pw = await hashPassword(DEMO_PASSWORD);
  await prisma.user.upsert({ where: { email: "plataforma@242erp.local" }, create: { email: "plataforma@242erp.local", name: "Admin da Plataforma", passwordHash: pw, isPlatformAdmin: true }, update: {} });

  if (await prisma.organization.findUnique({ where: { slug: "consultoria-demo" } })) {
    console.log("Dados de demonstração já existem. Para recriar, recrie o banco de desenvolvimento e execute novamente.");
  } else {
    await seedDemo(DEMO_PASSWORD);
  }
  console.log(`\nCredenciais de demonstração (somente ambiente local) — senha: ${DEMO_PASSWORD}`);
  const users = await prisma.user.findMany({ where: { email: { endsWith: ".local" } }, orderBy: { email: "asc" } });
  for (const u of users) console.log(`  ${u.email.padEnd(40)} ${u.name}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
