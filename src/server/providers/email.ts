import { prisma } from "../db";
import { providerName } from "./env";
import { logger } from "../logger";

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  organizationId?: string | null;
}

export interface EmailProvider {
  name: string;
  send(msg: EmailMessage): Promise<{ id: string }>;
}

/** Provedor simulado: registra na caixa de saída com status SIMULATED. Nada é enviado. */
export const simulatedEmailProvider: EmailProvider = {
  name: "simulated",
  async send(msg) {
    const row = await prisma.outboundMessage.create({
      data: { organizationId: msg.organizationId ?? null, channel: "EMAIL", to: msg.to, subject: msg.subject, body: msg.body, provider: "simulated", status: "SIMULATED", sentAt: new Date() },
    });
    logger.info("email.simulated", { to: msg.to, subject: msg.subject, id: row.id });
    return { id: row.id };
  },
};

const providers: Record<string, EmailProvider> = { simulated: simulatedEmailProvider };

/** Registra adaptador real (ex.: SMTP/SES) — ver docs/INTEGRACOES.md. */
export function registerEmailProvider(p: EmailProvider) {
  providers[p.name] = p;
}

export async function sendEmail(msg: EmailMessage) {
  const p = providers[providerName("EMAIL")] ?? simulatedEmailProvider;
  return p.send(msg);
}
