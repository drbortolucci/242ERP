/**
 * Adaptador de emissão de NFS-e. Em desenvolvimento/teste o provedor é SEMPRE o simulado (nenhuma nota real é emitida).
 * Um provedor real (prefeitura/agregador) deve implementar esta interface e ser validado pelo responsável fiscal.
 */
import { randomUUID } from "node:crypto";
import { hmacSha256, safeEqual } from "../auth/crypto";
import { webhookSecret } from "../config-check";
import { providerName } from "./env";

export interface FiscalIssueRequest {
  idempotencyKey: string;
  company: { cnpj: string; municipalRegistration: string | null; municipalityCode: string | null };
  customer: { name: string; document: string | null };
  services: { serviceCode: string; description: string; amount: string }[];
  grossAmount: string;
  withholdings: { code: string; amount: string }[];
}
/** NF-e de mercadorias: dados do emitente, destinatário e itens com a tributação da regra validada pela empresa. */
export interface ProductInvoiceRequest {
  idempotencyKey: string;
  company: { cnpj: string; stateRegistration: string | null; taxRegime: string | null; municipalityCode: string | null };
  customer: { name: string; document: string | null; email?: string | null; address?: unknown };
  items: { code: string; description: string; ncm: string | null; cfop: string; unit: string; quantity: string; unitPrice: string; amount: string; icmsCst: string | null; icmsRatePct: string | null; ipiCst: string | null; ipiRatePct: string | null; pisCst: string | null; pisRatePct: string | null; cofinsCst: string | null; cofinsRatePct: string | null }[];
  freightAmount: string;
  discountAmount: string;
  totalAmount: string;
}
export interface FiscalIssueResult { status: "AUTHORIZED" | "PROCESSING" | "REJECTED"; externalId: string; number?: string; verificationCode?: string; message?: string }

export interface FiscalProvider {
  name: string;
  environment: "SIMULATED" | "SANDBOX" | "PRODUCTION";
  issue(req: FiscalIssueRequest): Promise<FiscalIssueResult>;
  issueProduct(req: ProductInvoiceRequest): Promise<FiscalIssueResult>;
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
  async issueProduct(req) {
    // Simulação: valida dados mínimos e "autoriza" com número fictício — NÃO é documento fiscal válido.
    const missing = req.items.filter((i) => !i.ncm || !i.cfop).map((i) => i.code);
    if (missing.length) return { status: "REJECTED", externalId: `sim_${randomUUID()}`, message: `Itens sem NCM ou CFOP: ${missing.join(", ")}.` };
    if (!req.customer.document) return { status: "REJECTED", externalId: `sim_${randomUUID()}`, message: "Destinatário sem CPF/CNPJ." };
    simSeq += 1;
    return { status: "AUTHORIZED", externalId: `sim_${randomUUID()}`, number: `SIM-NFE-${Date.now().toString().slice(-6)}${simSeq}`, verificationCode: randomUUID().replace(/-/g, "").slice(0, 44).toUpperCase() };
  },
  async cancel() {
    return { ok: true };
  },
  verifyWebhook(rawBody, signature) {
    const secret = webhookSecret("FISCAL_WEBHOOK_SECRET");
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
