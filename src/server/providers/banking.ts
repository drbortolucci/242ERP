/**
 * Adaptador de cobrança bancária (boleto registrado e PIX com vencimento) para títulos a receber das organizações.
 * Em desenvolvimento/teste — e em homologação sem ALLOW_EXTERNAL_IN_STAGING — o provedor é SEMPRE o simulado:
 * nenhum boleto ou cobrança PIX real é registrado e os códigos gerados não são pagáveis.
 * Um provedor real (API do banco ou gateway de pagamentos) implementa esta interface e é homologado com o banco
 * antes do uso em produção. Credenciais ficam no cofre do ambiente (nunca no código ou no banco de dados).
 */
import { randomUUID } from "node:crypto";
import { hmacSha256, safeEqual } from "../auth/crypto";
import { webhookSecret } from "../config-check";
import { externalActionsAllowed } from "./env";

export interface ChargeRequest {
  idempotencyKey: string;
  method: "BOLETO" | "PIX";
  amount: string;
  dueDate: string;
  finePct?: string | null;
  interestPctMonth?: string | null;
  payer: { name: string; document: string | null; email?: string | null };
  beneficiary: { cnpj: string; name: string };
  description: string;
}
export interface ChargeResult {
  status: "REGISTERED" | "PENDING" | "ERROR";
  externalId: string;
  digitableLine?: string;
  pixCode?: string;
  paymentUrl?: string;
  message?: string;
}
/** Evento normalizado de webhook do provedor. */
export interface ChargeEvent {
  externalId: string;
  type: "PAID" | "CANCELED" | "EXPIRED";
  paidAmount?: string;
  paidAt?: string;
}

export interface BankingProvider {
  name: string;
  environment: "SIMULATED" | "SANDBOX" | "PRODUCTION";
  createCharge(req: ChargeRequest): Promise<ChargeResult>;
  cancelCharge(externalId: string): Promise<{ ok: boolean; message?: string }>;
  verifyWebhook(rawBody: string, signature: string | null): boolean;
  parseWebhook(rawBody: string): ChargeEvent | null;
}

export const simulatedBankingProvider: BankingProvider = {
  name: "simulated",
  environment: "SIMULATED",
  async createCharge(req) {
    if (!req.payer.document) return { status: "ERROR", externalId: `simchg_${randomUUID()}`, message: "Pagador sem CPF/CNPJ: obrigatório para registro da cobrança." };
    const id = `simchg_${randomUUID()}`;
    // Códigos deliberadamente inválidos para pagamento (prefixo SIMULADO)
    return req.method === "BOLETO"
      ? { status: "REGISTERED", externalId: id, digitableLine: `SIMULADO ${id.slice(7, 19).toUpperCase()} — boleto de teste, não pagável` }
      : { status: "REGISTERED", externalId: id, pixCode: `SIMULADO|PIX|${id.slice(7)}|${req.amount}|não pagável` };
  },
  async cancelCharge() {
    return { ok: true };
  },
  verifyWebhook(rawBody, signature) {
    const secret = webhookSecret("BANKING_WEBHOOK_SECRET");
    if (!secret || !signature) return false;
    return safeEqual(hmacSha256(secret, rawBody), signature);
  },
  parseWebhook(rawBody) {
    const b = JSON.parse(rawBody) as Partial<ChargeEvent>;
    if (!b.externalId || !["PAID", "CANCELED", "EXPIRED"].includes(b.type ?? "")) return null;
    return { externalId: b.externalId, type: b.type as ChargeEvent["type"], paidAmount: b.paidAmount, paidAt: b.paidAt };
  },
};

const providers: Record<string, BankingProvider> = { simulated: simulatedBankingProvider };
export function registerBankingProvider(p: BankingProvider) {
  providers[p.name] = p;
}
/** Provedor efetivo: o configurado pela organização somente quando ações externas são permitidas no ambiente. */
export function bankingProvider(configured?: string | null): BankingProvider {
  if (!externalActionsAllowed()) return simulatedBankingProvider;
  return providers[configured ?? process.env.BANKING_PROVIDER ?? "simulated"] ?? simulatedBankingProvider;
}
