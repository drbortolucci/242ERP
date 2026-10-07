/**
 * Adaptador de emissão de NFS-e. Em desenvolvimento/teste o provedor é SEMPRE o simulado (nenhuma nota real é emitida).
 * Um provedor real (prefeitura/agregador) deve implementar esta interface e ser validado pelo responsável fiscal.
 */
import { randomUUID } from "node:crypto";
import { hmacSha256, safeEqual } from "../auth/crypto";
import { providerName } from "./env";

export interface FiscalIssueRequest {
  idempotencyKey: string;
  company: { cnpj: string; municipalRegistration: string | null; municipalityCode: string | null };
  customer: { name: string; document: string | null };
  services: { serviceCode: string; description: string; amount: string }[];
  grossAmount: string;
  withholdings: { code: string; amount: string }[];
}
export interface FiscalIssueResult { status: "AUTHORIZED" | "PROCESSING" | "REJECTED"; externalId: string; number?: string; verificationCode?: string; message?: string }

export interface FiscalProvider {
  name: string;
  environment: "SIMULATED" | "SANDBOX" | "PRODUCTION";
  issue(req: FiscalIssueRequest): Promise<FiscalIssueResult>;
  cancel(externalId: string, reason: string): Promise<{ ok: boolean; message?: string }>;
  verifyWebhook(rawBody: string, signature: string | null): boolean;
}

let simSeq = 0;
export const simulatedFiscalProvider: FiscalProvider = {
  name: "simulated",
  environment: "SIMULATED",
  async issue(req) {
    // Simulação: valida dados mínimos e "autoriza" com número fictício — NÃO é documento fiscal válido.
    if (!req.services.length || req.services.some((s) => !s.serviceCode)) return { status: "REJECTED", externalId: `sim_${randomUUID()}`, message: "Código de serviço municipal não cadastrado para os serviços do documento." };
    simSeq += 1;
    return { status: "AUTHORIZED", externalId: `sim_${randomUUID()}`, number: `SIM-${Date.now().toString().slice(-6)}${simSeq}`, verificationCode: randomUUID().slice(0, 8).toUpperCase() };
  },
  async cancel() {
    return { ok: true };
  },
  verifyWebhook(rawBody, signature) {
    const secret = process.env.FISCAL_WEBHOOK_SECRET;
    if (!secret || !signature) return false;
    return safeEqual(hmacSha256(secret, rawBody), signature);
  },
};

const providers: Record<string, FiscalProvider> = { simulated: simulatedFiscalProvider };
export function registerFiscalProvider(p: FiscalProvider) {
  providers[p.name] = p;
}
export function fiscalProvider(): FiscalProvider {
  return providers[providerName("FISCAL")] ?? simulatedFiscalProvider;
}
