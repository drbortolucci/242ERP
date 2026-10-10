import type { ReactNode } from "react";
import { requireCtx } from "@/server/auth/next";
import { pageAnyPerm } from "@/server/page-guard";

export default async function AccountingLayout({ children }: { children: ReactNode }) {
  pageAnyPerm(await requireCtx(), "accounting.read");
  return children;
}
