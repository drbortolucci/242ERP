/**
 * Dados de demonstração — gerados por meio dos MESMOS serviços da aplicação (sem números fixos).
 * Credenciais exclusivas do ambiente local. Nunca reutilize em produção.
 */
import { prisma } from "../src/server/db";
import { ensurePlans } from "../src/modules/saas/plans";
import { hashPassword } from "../src/server/auth/crypto";
import { seedDemo } from "./seed-demo";

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "Demo@2026local";
const LOCAL = !["staging"].includes(process.env.APP_ENV ?? "");

async function main() {
  if (process.env.APP_ENV === "production") throw new Error("Seed de demonstração não pode ser executado em produção.");
  // Homologação online: a senha de demonstração local nunca é usada fora do ambiente local
  if (!LOCAL && !process.env.DEMO_PASSWORD) throw new Error("Em homologação defina DEMO_PASSWORD (senha forte e exclusiva do ambiente).");
  await ensurePlans();
  const pw = await hashPassword(DEMO_PASSWORD);
  await prisma.user.upsert({ where: { email: "plataforma@242erp.local" }, create: { email: "plataforma@242erp.local", name: "Admin da Plataforma", passwordHash: pw, isPlatformAdmin: true }, update: {} });

  if (await prisma.organization.findUnique({ where: { slug: "consultoria-demo" } })) {
    console.log("Dados de demonstração já existem. Para recriar, recrie o banco de desenvolvimento e execute novamente.");
  } else {
    await seedDemo(DEMO_PASSWORD);
  }
  console.log(LOCAL ? `\nCredenciais de demonstração (somente ambiente local) — senha: ${DEMO_PASSWORD}` : "\nUsuários de demonstração (senha definida em DEMO_PASSWORD, não exibida):");
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
