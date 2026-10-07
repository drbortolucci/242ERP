import type { ReactNode } from "react";
import { requireCtx } from "@/server/auth/next";
import { pageModule } from "@/server/page-guard";

/** Módulo fora do plano contratado (ou desabilitado pela organização): página "Acesso não permitido". */
export default async function ModuleLayout({ children }: { children: ReactNode }) {
  pageModule(await requireCtx(), "controlling");
  return children;
}
