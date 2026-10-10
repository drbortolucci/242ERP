import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Cliente "raiz" — sem escopo de tenant. Usar somente em autenticação, plataforma e jobs que montam contexto. */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"],
    // Banco remoto (pooler, outra zona): o padrão do Prisma (5 s) derruba transações longas legítimas,
    // como aprovação de horas em lote, sincronização do razão e faturamento. Ajustável por ambiente.
    transactionOptions: {
      maxWait: Number(process.env.DB_TX_MAX_WAIT_MS ?? 10_000),
      timeout: Number(process.env.DB_TX_TIMEOUT_MS ?? 60_000),
    },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
