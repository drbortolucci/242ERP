import { NextResponse } from "next/server";
import { handleFiscalWebhook } from "@/modules/billing/fiscal";
import { logger } from "@/server/logger";

/** Webhook do provedor fiscal (NFS-e): assinatura HMAC obrigatória e processamento idempotente. */
export async function POST(req: Request) {
  const raw = await req.text();
  try {
    const r = await handleFiscalWebhook(raw, req.headers.get("x-signature"));
    if (!r.ok) logger.warn("fiscal.webhook.rejected", { status: r.status });
    return NextResponse.json(r, { status: r.status });
  } catch (e) {
    logger.error("fiscal.webhook.error", { error: e as Error });
    return NextResponse.json({ error: "falha ao processar" }, { status: 500 });
  }
}
