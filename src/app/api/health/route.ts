import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { checkConfig } from "@/server/config-check";

/** Monitoramento de saúde: aplicação + banco + fila de tarefas. */
export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const failedJobs = await prisma.job.count({ where: { status: "FAILED" } });
    const pendingJobs = await prisma.job.count({ where: { status: "PENDING", runAt: { lt: new Date(Date.now() - 10 * 60000) } } });
    return NextResponse.json({ status: "ok", db: "ok", latencyMs: Date.now() - started, jobs: { failed: failedJobs, delayedPending: pendingJobs }, configWarnings: checkConfig().length, env: process.env.APP_ENV ?? "development" });
  } catch {
    return NextResponse.json({ status: "error", db: "unreachable" }, { status: 503 });
  }
}
