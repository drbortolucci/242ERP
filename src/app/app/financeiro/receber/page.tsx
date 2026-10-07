import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import type { SearchParams } from "@/lib/query";
import { TitlesList } from "../titles-list";

export const metadata = { title: "Contas a receber" };
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireCtx();
  pagePerm(ctx, "finance.read");
  return <TitlesList ctx={ctx} kind="RECEIVABLE" s={await searchParams} />;
}
