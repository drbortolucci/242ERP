/**
 * Provedor de pagamentos de ASSINATURAS SaaS (cobrança da plataforma às consultorias).
 * Não confundir com o faturamento de serviços das consultorias aos seus clientes.
 */
import { randomUUID } from "node:crypto";
import { hmacSha256, safeEqual } from "../auth/crypto";
import { providerName } from "./env";

export interface CheckoutResult {
  providerSubscriptionId: string;
  providerCustomerId: string;
  status: "ACTIVE" | "PENDING";
  invoice?: { id: string; amount: string; paid: boolean };
}

export interface PaymentProvider {
  name: string;
  /** Cria/atualiza a assinatura do cliente no provedor. */
  subscribe(input: { organizationId: string; planCode: string; amount: string; email: string }): Promise<CheckoutResult>;
  cancel(providerSubscriptionId: string): Promise<void>;
  /** Verifica a assinatura HMAC do webhook. */
  verifyWebhook(rawBody: string, signature: string | null): boolean;
}

export const simulatedPaymentProvider: PaymentProvider = {
  name: "simulated",
  async subscribe(input) {
    // Simulação: aprova imediatamente, sem cobrança real.
    return { providerSubscriptionId: `sim_sub_${input.organizationId}`, providerCustomerId: `sim_cus_${input.organizationId}`, status: "ACTIVE", invoice: { id: `sim_inv_${randomUUID()}`, amount: input.amount, paid: true } };
  },
  async cancel() {},
  verifyWebhook(rawBody, signature) {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret || !signature) return false;
    return safeEqual(hmacSha256(secret, rawBody), signature);
  },
};

const providers: Record<string, PaymentProvider> = { simulated: simulatedPaymentProvider };
export function registerPaymentProvider(p: PaymentProvider) {
  providers[p.name] = p;
}
export function paymentProvider(): PaymentProvider {
  return providers[providerName("PAYMENT")] ?? simulatedPaymentProvider;
}
