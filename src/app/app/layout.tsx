import { requireCtx, userOrganizations } from "@/server/auth/next";
import { AppShell } from "@/components/layout/shell";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  if (ctx.kind === "CLIENT") redirect("/portal");
  const [orgs, unread, favorites] = await Promise.all([
    userOrganizations(ctx.userId),
    ctx.db.notification.count({ where: { userId: ctx.userId, readAt: null } }),
    ctx.db.favorite.findMany({ where: { userId: ctx.userId }, orderBy: { label: "asc" } }),
  ]);
  return <AppShell ctx={ctx} orgs={orgs} unread={unread} favorites={favorites}>{children}</AppShell>;
}
