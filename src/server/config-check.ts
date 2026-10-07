/**
 * Verificação de configuração do ambiente. Em produção, problemas críticos impedem a inicialização
 * (ex.: segredo de sessão fraco ou de exemplo, URL sem HTTPS); avisos são registrados no log.
 */
import { appEnv } from "./providers/env";

export interface ConfigIssue { level: "error" | "warn"; message: string }
const PLACEHOLDERS = ["troque-este-valor", "dev-only-secret", "change-me", "changeme"];

function isPlaceholder(v: string) {
  return PLACEHOLDERS.some((p) => v.includes(p));
}

/** Segredo de webhook utilizável: ausente ou com valor de exemplo (fora de desenvolvimento/teste) é tratado como não configurado. */
export function webhookSecret(name: "PAYMENT_WEBHOOK_SECRET" | "FISCAL_WEBHOOK_SECRET"): string | null {
  const v = process.env[name];
  if (!v) return null;
  if (isPlaceholder(v) && !["development", "test"].includes(appEnv())) return null;
  return v;
}

export function checkConfig(env: NodeJS.ProcessEnv = process.env): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const prod = (env.APP_ENV ?? "development") === "production";
  const secret = env.SESSION_SECRET ?? "";
  if (!env.DATABASE_URL) issues.push({ level: "error", message: "DATABASE_URL não definido." });
  if (secret.length < 32 || PLACEHOLDERS.some((p) => secret.includes(p))) issues.push({ level: prod ? "error" : "warn", message: "SESSION_SECRET ausente, curto (< 32) ou de exemplo." });
  if (prod && !(env.APP_URL ?? "").startsWith("https://")) issues.push({ level: "error", message: "APP_URL deve usar HTTPS em produção." });
  for (const k of ["PAYMENT_WEBHOOK_SECRET", "FISCAL_WEBHOOK_SECRET"]) {
    if (prod && !env[k]) issues.push({ level: "warn", message: `${k} não configurado: webhooks correspondentes serão recusados.` });
    else if (prod && isPlaceholder(env[k]!)) issues.push({ level: "error", message: `${k} com valor de exemplo.` });
  }
  for (const k of ["EMAIL_PROVIDER", "PAYMENT_PROVIDER", "FISCAL_PROVIDER"]) if (prod && (env[k] ?? "simulated") === "simulated") issues.push({ level: "warn", message: `${k}=simulated em produção: a funcionalidade permanece simulada (nenhuma ação externa).` });
  if (prod && (env.STORAGE_DIR ?? "./storage").startsWith("./")) issues.push({ level: "warn", message: "STORAGE_DIR relativo: use volume persistente com backup." });
  return issues;
}

export function assertConfig() {
  const issues = checkConfig();
  for (const i of issues) console[i.level === "error" ? "error" : "warn"](`[config] ${i.message}`);
  if (appEnv() === "production" && issues.some((i) => i.level === "error")) throw new Error("Configuração inválida para produção: " + issues.filter((i) => i.level === "error").map((i) => i.message).join(" "));
}
