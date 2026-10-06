import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z, ZodError, type ZodTypeAny } from "zod";
import { requireCtx } from "./auth/next";
import { toAppError } from "@/lib/errors";
import type { Ctx } from "./context";
import { logger } from "./logger";

export type ActionState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  message?: string;
  data?: unknown;
};

/** Converte FormData em objeto. Campos com sufixo [] viram arrays; checkbox "on" vira true. */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (k.endsWith("[]")) {
      const key = k.slice(0, -2);
      const arr = (out[key] as unknown[] | undefined) ?? [];
      arr.push(v);
      out[key] = arr;
    } else out[k] = v;
  }
  return out;
}

export interface ActionResult {
  message?: string;
  redirectTo?: string;
  revalidate?: string[];
  data?: unknown;
}

/**
 * Fábrica de Server Actions: autentica, valida (zod), executa o caso de uso e traduz erros.
 * A autorização fina ocorre dentro dos serviços (requirePerm etc.).
 */
export function makeAction<S extends ZodTypeAny>(schema: S, handler: (ctx: Ctx, input: z.infer<S>) => Promise<ActionResult | void>) {
  return async function action(_prev: ActionState | undefined, fd: FormData): Promise<ActionState> {
    const ctx = await requireCtx();
    let result: ActionResult | void;
    try {
      const input = schema.parse(formToObject(fd));
      result = await handler(ctx, input);
    } catch (e) {
      if (e instanceof ZodError) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of e.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
        return { ok: false, error: "Verifique os campos destacados.", fieldErrors };
      }
      const err = toAppError(e);
      if (err.message.startsWith("Erro inesperado")) logger.error("action.error", { error: e as Error, correlationId: ctx.correlationId });
      return { ok: false, error: err.message, fieldErrors: (err.details?.fieldErrors as Record<string, string>) ?? undefined };
    }
    for (const p of result?.revalidate ?? []) revalidatePath(p);
    if (result?.redirectTo) redirect(result.redirectTo);
    return { ok: true, message: result?.message ?? "Operação realizada com sucesso.", data: result?.data };
  };
}

/** Para ações de botão simples (sem estado de formulário) — lança erro para a página de erro. */
export function simpleAction<S extends ZodTypeAny>(schema: S, handler: (ctx: Ctx, input: z.infer<S>) => Promise<ActionResult | void>) {
  const a = makeAction(schema, handler);
  return async (fd: FormData) => {
    const r = await a(undefined, fd);
    if (r.error) throw new Error(r.error);
  };
}
