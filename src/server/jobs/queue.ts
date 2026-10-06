import { prisma } from "../db";
import { logger } from "../logger";

export type JobHandler = (payload: Record<string, unknown>, job: { id: string; organizationId: string | null; createdById: string | null }) => Promise<unknown>;
const handlers = new Map<string, JobHandler>();

export function registerJob(type: string, h: JobHandler) {
  handlers.set(type, h);
}

/** Enfileira tarefa. `uniqueKey` garante idempotência (ex.: "sla-check:2026-10-06T12:00"). */
export async function enqueue(type: string, payload: Record<string, unknown>, opts: { organizationId?: string | null; uniqueKey?: string; runAt?: Date; createdById?: string; maxAttempts?: number } = {}) {
  if (opts.uniqueKey) {
    const existing = await prisma.job.findUnique({ where: { uniqueKey: opts.uniqueKey } });
    if (existing) return existing;
  }
  try {
    return await prisma.job.create({
      data: { type, payload: payload as object, organizationId: opts.organizationId ?? null, uniqueKey: opts.uniqueKey ?? null, runAt: opts.runAt ?? new Date(), createdById: opts.createdById ?? null, maxAttempts: opts.maxAttempts ?? 5 },
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002" && opts.uniqueKey) return prisma.job.findUniqueOrThrow({ where: { uniqueKey: opts.uniqueKey } });
    throw e;
  }
}

/** Reserva o próximo job disponível (FOR UPDATE SKIP LOCKED — seguro com vários workers). */
async function claim(): Promise<{ id: string } | null> {
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `UPDATE "Job" SET status = 'RUNNING', "lockedAt" = now(), attempts = attempts + 1
     WHERE id = (SELECT id FROM "Job" WHERE status = 'PENDING' AND "runAt" <= now() ORDER BY "runAt" LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING id`,
  );
  return rows[0] ?? null;
}

export async function runJob(id: string) {
  const job = await prisma.job.findUniqueOrThrow({ where: { id } });
  const h = handlers.get(job.type);
  try {
    if (!h) throw new Error(`Sem manipulador para ${job.type}`);
    const result = await h(job.payload as Record<string, unknown>, job);
    await prisma.job.update({ where: { id }, data: { status: "DONE", finishedAt: new Date(), result: (result ?? null) as object, lastError: null } });
    return { ok: true, result };
  } catch (e) {
    const msg = (e as Error).message?.slice(0, 1000) ?? "erro";
    const failed = job.attempts >= job.maxAttempts;
    const backoffMs = Math.min(3600_000, 2 ** job.attempts * 30_000);
    await prisma.job.update({ where: { id }, data: { status: failed ? "FAILED" : "PENDING", lastError: msg, runAt: new Date(Date.now() + backoffMs), lockedAt: null } });
    logger.error("job.failed", { id, type: job.type, attempt: job.attempts, error: msg });
    return { ok: false, error: msg };
  }
}

/** Processa jobs disponíveis até esvaziar a fila (ou atingir o limite). */
export async function drain(limit = 50) {
  let n = 0;
  while (n < limit) {
    const j = await claim();
    if (!j) break;
    await runJob(j.id);
    n++;
  }
  return n;
}

/** Executa imediatamente um job recém-criado (para ações solicitadas pelo usuário), mantendo o registro na fila. */
export async function enqueueAndRun(type: string, payload: Record<string, unknown>, opts: Parameters<typeof enqueue>[2] = {}) {
  const job = await enqueue(type, payload, opts);
  if (job.status !== "PENDING") return job;
  const claimed = await prisma.job.updateMany({ where: { id: job.id, status: "PENDING" }, data: { status: "RUNNING", lockedAt: new Date(), attempts: { increment: 1 } } });
  if (claimed.count) await runJob(job.id);
  return prisma.job.findUniqueOrThrow({ where: { id: job.id } });
}
