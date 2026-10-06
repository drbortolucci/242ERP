import { redirect, notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/next";
export default async function AmendmentRedirect({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const a = await ctx.db.contractAmendment.findFirst({ where: { id: (await params).id } });
  if (!a) notFound();
  redirect(`/app/contratos/${a.contractId}?tab=aditivos`);
}
