import "server-only";
import NextLink from "next/link";
import type { ComponentProps } from "react";
import { requestAccess } from "@/server/auth/next";
import { canOpenRoute } from "@/lib/route-access";

/**
 * Link que respeita o acesso do usuário: se a rota de destino exige permissão ou módulo que o usuário não tem,
 * o conteúdo é exibido como texto (sem link para "Acesso não permitido"). A segurança continua nas guardas das páginas.
 * Componente síncrono: usa o acesso já carregado pela página (requireCtx/getCtx) na mesma requisição.
 */
export default function AccessLink({ href, children, className, ...rest }: ComponentProps<typeof NextLink>) {
  if (typeof href === "string" && href.startsWith("/app")) {
    const a = requestAccess();
    if (a.perms && !canOpenRoute(href, a.perms, a.modules)) return <span className={className?.replace(/\btext-brand-\d+\b|\bhover:underline\b|\bunderline\b/g, "")}>{children}</span>;
  }
  return <NextLink href={href} className={className} {...rest}>{children}</NextLink>;
}
