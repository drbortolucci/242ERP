import "server-only";
import { forbidden } from "next/navigation";
import type { Ctx } from "./context";
import type { Permission } from "@/lib/permissions";

/** Guarda de página: responde 403 (página "Acesso não permitido") quando faltar permissão. */
export function pagePerm(ctx: Ctx, ...perms: Permission[]) {
  if (!perms.every((p) => ctx.permissions.has(p))) forbidden();
}
export function pageAnyPerm(ctx: Ctx, ...perms: Permission[]) {
  if (!perms.some((p) => ctx.permissions.has(p))) forbidden();
}
export function pageModule(ctx: Ctx, module: string) {
  if (!ctx.planModules.includes(module)) forbidden();
}
