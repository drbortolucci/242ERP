import { NextResponse } from "next/server";
import { apiCreate, apiList } from "@/modules/api/service";
import { isAppError, toAppError, validation } from "@/lib/errors";
import { logger } from "@/server/logger";

const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, PLAN_LIMIT: 403, NOT_FOUND: 404, VALIDATION: 422, BUSINESS_RULE: 422, PERIOD_CLOSED: 422, CONFLICT: 409, RATE_LIMITED: 429 };
function fail(e: unknown) {
  const known = isAppError(e) || !!(e as { code?: string })?.code?.startsWith?.("P20");
  if (!known) {
    logger.error("api.error", { error: e as Error });
    return NextResponse.json({ error: { code: "INTERNAL", message: "Erro interno." } }, { status: 500 });
  }
  const err = toAppError(e);
  return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: STATUS[err.code] ?? 400 });
}

/** GET /api/v1/{clientes|contratos|projetos|chamados|titulos-receber}?page=&limit=&updatedSince= */
export async function GET(req: Request, { params }: { params: Promise<{ resource: string }> }) {
  try {
    return NextResponse.json(await apiList((await params).resource, req.headers.get("authorization"), req.url));
  } catch (e) {
    return fail(e);
  }
}

/** POST /api/v1/chamados (JSON) */
export async function POST(req: Request, { params }: { params: Promise<{ resource: string }> }) {
  try {
    let body: unknown;
    try { body = await req.json(); } catch { throw validation("JSON inválido."); }
    return NextResponse.json(await apiCreate((await params).resource, req.headers.get("authorization"), body), { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
