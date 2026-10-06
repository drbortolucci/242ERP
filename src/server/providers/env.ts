/**
 * Ambiente de execução. Em "development" e "test" NENHUMA ação externa real é executada:
 * todos os provedores são forçados ao modo simulado, independentemente da configuração.
 */
export type AppEnv = "development" | "test" | "staging" | "production";

export function appEnv(): AppEnv {
  const v = process.env.APP_ENV ?? (process.env.NODE_ENV === "test" ? "test" : "development");
  return (["development", "test", "staging", "production"].includes(v) ? v : "development") as AppEnv;
}

export function externalActionsAllowed(): boolean {
  const env = appEnv();
  return env === "production" || (env === "staging" && process.env.ALLOW_EXTERNAL_IN_STAGING === "1");
}

export function providerName(kind: "EMAIL" | "PAYMENT" | "FISCAL"): string {
  const configured = process.env[`${kind}_PROVIDER`] ?? "simulated";
  return externalActionsAllowed() ? configured : "simulated";
}
