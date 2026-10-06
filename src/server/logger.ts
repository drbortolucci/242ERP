/** Log estruturado em JSON (uma linha por evento). Nunca registre senhas, tokens ou segredos. */
type Level = "debug" | "info" | "warn" | "error";
const REDACT = /pass|token|secret|authorization|cookie|hash/i;

function clean(meta?: Record<string, unknown>) {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) out[k] = REDACT.test(k) ? "[redacted]" : v instanceof Error ? { message: v.message, stack: v.stack } : v;
  return out;
}

function log(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test" && level !== "error") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...clean(meta) });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (m: string, meta?: Record<string, unknown>) => log("debug", m, meta),
  info: (m: string, meta?: Record<string, unknown>) => log("info", m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => log("warn", m, meta),
  error: (m: string, meta?: Record<string, unknown>) => log("error", m, meta),
};
