export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "BUSINESS_RULE"
  | "PERIOD_CLOSED"
  | "PLAN_LIMIT"
  | "RATE_LIMITED";

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const validation = (msg: string, details?: Record<string, unknown>) => new AppError("VALIDATION", msg, details);
export const forbidden = (msg = "Você não tem permissão para esta operação.") => new AppError("FORBIDDEN", msg);
export const notFound = (what = "Registro") => new AppError("NOT_FOUND", `${what} não encontrado(a).`);
export const conflict = (msg: string) => new AppError("CONFLICT", msg);
export const rule = (msg: string, details?: Record<string, unknown>) => new AppError("BUSINESS_RULE", msg, details);

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Mapeia erros conhecidos do Prisma para mensagens de negócio. */
export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  const code = (e as { code?: string })?.code;
  if (code === "P2002") return conflict("Registro duplicado: já existe um registro com estes dados.");
  if (code === "P2025") return notFound();
  if (code === "P2034") return conflict("Operação concorrente detectada. Tente novamente.");
  return new AppError("BUSINESS_RULE", "Erro inesperado. A ocorrência foi registrada.");
}
