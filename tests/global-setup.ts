import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

/** Recria o banco de TESTE (descartável) e aplica as migrações versionadas. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://erp:erp_local_dev@localhost:5432/erp_test";
  if (!/_test(\?|$)/.test(url)) throw new Error("TEST_DATABASE_URL deve apontar para um banco cujo nome termina em _test");
  const client = new PrismaClient({ datasourceUrl: url });
  await client.$executeRawUnsafe("DROP SCHEMA IF EXISTS public CASCADE");
  await client.$executeRawUnsafe("CREATE SCHEMA public");
  await client.$disconnect();
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}
