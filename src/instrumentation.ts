/** Executado uma vez na inicialização do servidor: valida a configuração do ambiente. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") (await import("./server/config-check")).assertConfig();
}
