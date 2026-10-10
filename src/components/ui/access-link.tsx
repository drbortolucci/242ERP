import "server-only";
import NextLink from "next/link";
import type { ComponentProps } from "react";
import { getCtx } from "@/server/auth/next";
import { canOpenRoute } from "@/lib/route-access";

/**
 * Link que respeita o acesso do usuário: se a rota de destino exige permissão ou módulo que o usuário não tem,
 * o conteúdo é exibido como texto (sem link para "Acesso não permitido"). A segurança continua nas guardas das páginas.
 */
export default async function AccessLink({ href, children, className, ...rest }: ComponentProps<typeof NextLink>) {
  if (typeof href === "string" && href.startsWith("/app")) {
    const ctx = await getCtx();
    if (ctx && !canOpenRoute(href, ctx.permissions, ctx.planModules)) return <span className={className?.replace(/\btext-brand-\d+\b|\bhover:underline\b|\bunderline\b/g, "")}>{children}</span>;
  }
  return <NextLink href={href} className={className} {...rest}>{children}</NextLink>;
}
