import { prisma } from "../db";
import { AppError } from "@/lib/errors";

/**
 * Limitação de taxa persistida no banco (funciona com múltiplas instâncias).
 * Lança RATE_LIMITED quando excede `limit` eventos na janela.
 */
export async function rateLimit(key: string, limit: number, windowSec: number) {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowSec * 1000);
  const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(
    `INSERT INTO "RateLimitBucket" ("key","count","resetAt") VALUES ($1,1,$2)
     ON CONFLICT ("key") DO UPDATE SET
       "count" = CASE WHEN "RateLimitBucket"."resetAt" < $3 THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
       "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" < $3 THEN $2 ELSE "RateLimitBucket"."resetAt" END
     RETURNING "count"`,
    key, resetAt, now,
  );
  if (rows[0].count > limit) throw new AppError("RATE_LIMITED", "Muitas tentativas. Aguarde alguns minutos e tente novamente.");
}
