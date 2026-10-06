import { NextResponse } from "next/server";
import { paymentProvider } from "@/server/providers/payments";
import { handlePaymentWebhook } from "@/modules/saas/subscription";
import { logger } from "@/server/logger";

/** Webhook do provedor de assinaturas: assinatura HMAC obrigatória + idempotência por id do evento. */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const raw = await req.text();
  const p = paymentProvider();
  if (p.name !== provider || !p.verifyWebhook(raw, req.headers.get("x-signature"))) {
    logger.warn("webhook.rejected", { provider });
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }
  try {
    const r = await handlePaymentWebhook(provider, JSON.parse(raw));
    return NextResponse.json({ ok: true, duplicate: r.duplicate });
  } catch (e) {
    logger.error("webhook.error", { provider, error: e as Error });
    return NextResponse.json({ error: "falha ao processar" }, { status: 500 });
  }
}
