/**
 * Isolamento por construção: cliente Prisma estendido que injeta organizationId em TODAS as
 * consultas/escritas de modelos empresariais e restringe o escopo de empresas do usuário.
 * Não há relações Prisma entre modelos empresariais, portanto não existem "includes" que
 * escapem do filtro; dados relacionados são carregados por consultas também escopadas.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "@/lib/errors";

type FieldMap = Map<string, Set<string>>;
const modelFields: FieldMap = new Map(
  Prisma.dmmf.datamodel.models.map((m) => [m.name, new Set(m.fields.map((f) => f.name))]),
);
/** Modelos cujo companyId é opcional (registro "da organização", visível a todos os escopos). */
const optionalCompany = new Set(
  Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === "companyId" && !f.isRequired)).map((m) => m.name),
);

/** Modelos de plataforma que nunca são acessados pelo cliente escopado. */
const PLATFORM_ONLY = new Set(["Plan", "Organization", "User", "Session", "PasswordResetToken", "WebhookEvent", "RateLimitBucket"]);

export function isTenantModel(model: string) {
  return !PLATFORM_ONLY.has(model) && !!modelFields.get(model)?.has("organizationId");
}
function hasCompany(model: string) {
  // DocumentSequence usa companyId "" como chave técnica; Company é escopada pelo próprio id
  return model !== "DocumentSequence" && !!modelFields.get(model)?.has("companyId");
}

const READ_OPS = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);
const WHERE_WRITE_OPS = new Set(["update", "updateMany", "updateManyAndReturn", "delete", "deleteMany", "upsert"]);

export interface TenantScope {
  orgId: string;
  /** null = todas as empresas da organização */
  companyIds: string[] | null;
}

function companyFilter(model: string, scope: TenantScope): Record<string, unknown> | null {
  if (scope.companyIds === null) return null;
  if (model === "Company") return { id: { in: scope.companyIds } };
  if (!hasCompany(model)) return null;
  if (optionalCompany.has(model)) return { OR: [{ companyId: null }, { companyId: { in: scope.companyIds } }] };
  return { companyId: { in: scope.companyIds } };
}

function scopeWhere(model: string, where: Record<string, unknown> | undefined, scope: TenantScope) {
  const w: Record<string, unknown> = { ...(where ?? {}), organizationId: scope.orgId };
  const cf = companyFilter(model, scope);
  if (cf) {
    const existing = w.AND ? (Array.isArray(w.AND) ? w.AND : [w.AND]) : [];
    w.AND = [...existing, cf];
  }
  return w;
}

function scopeData(model: string, data: Record<string, unknown>, scope: TenantScope) {
  if (data.organizationId && data.organizationId !== scope.orgId) {
    throw new AppError("FORBIDDEN", "Tentativa de gravar dados em outra organização.");
  }
  if (scope.companyIds !== null && hasCompany(model) && typeof data.companyId === "string" && data.companyId !== "") {
    if (!scope.companyIds.includes(data.companyId)) throw new AppError("FORBIDDEN", "Empresa fora do seu escopo de acesso.");
  }
  return { ...data, organizationId: scope.orgId };
}

export function createTenantDb(scope: TenantScope) {
  return prisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !isTenantModel(model)) {
            if (model && PLATFORM_ONLY.has(model) && operation !== "findUnique" && operation !== "findFirst" && operation !== "findMany") {
              throw new AppError("FORBIDDEN", `Modelo de plataforma ${model} não pode ser alterado pelo contexto do tenant.`);
            }
            return query(args);
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const a = (args ?? {}) as any;
          if (READ_OPS.has(operation) || WHERE_WRITE_OPS.has(operation)) {
            a.where = scopeWhere(model, a.where, scope);
          }
          if (operation === "create") a.data = scopeData(model, a.data, scope);
          if (operation === "createMany" || operation === "createManyAndReturn") {
            a.data = (Array.isArray(a.data) ? a.data : [a.data]).map((d: Record<string, unknown>) => scopeData(model, d, scope));
          }
          if (operation === "upsert") a.create = scopeData(model, a.create, scope);
          if ((operation === "update" || operation === "updateMany" || operation === "upsert") && a.data?.organizationId && a.data.organizationId !== scope.orgId) {
            throw new AppError("FORBIDDEN", "Não é permitido mover registros entre organizações.");
          }
          if (scope.companyIds !== null && hasCompany(model) && a.data && typeof a.data.companyId === "string" && (operation === "update" || operation === "updateMany")) {
            if (!scope.companyIds.includes(a.data.companyId)) throw new AppError("FORBIDDEN", "Empresa fora do seu escopo de acesso.");
          }
          return query(a);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof createTenantDb>;
/** Cliente transacional obtido via db.$transaction(async (tx) => ...) — mantém o escopo. */
export type TenantTx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];
