import { requireCtx, userOrganizations } from "@/server/auth/next";
import { AppShell } from "@/components/layout/shell";
import { redirect } from "next/navigation";
import { getTerms } from "@/modules/sectors/service";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  if (ctx.kind === "CLIENT") redirect("/portal");
  const [orgs, unread, favorites, terms] = await Promise.all([
    userOrganizations(ctx.userId),
    ctx.db.notification.count({ where: { userId: ctx.userId, readAt: null } }),
    ctx.db.favorite.findMany({ where: { userId: ctx.userId }, orderBy: { label: "asc" } }),
    getTerms(ctx),
  ]);
  return <AppShell ctx={ctx} orgs={orgs} unread={unread} favorites={favorites} terms={terms}>{children}</AppShell>;
}
