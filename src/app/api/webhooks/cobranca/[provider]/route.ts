import { NextResponse } from "next/server";
import { handleBankingWebhook } from "@/modules/banking/service";
import { logger } from "@/server/logger";

/** Aviso do provedor de cobrança (pagamento, baixa, expiração): assinatura HMAC obrigatória e processamento idempotente. */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const raw = await req.text();
  try {
    const r = await handleBankingWebhook(provider, raw, req.headers.get("x-signature"));
    if (!r.ok) logger.warn("banking.webhook.rejected", { status: r.status, provider });
    return NextResponse.json(r, { status: r.status });
  } catch (e) {
    logger.error("banking.webhook.error", { error: e as Error, provider });
    return NextResponse.json({ error: "falha ao processar" }, { status: 500 });
  }
}
