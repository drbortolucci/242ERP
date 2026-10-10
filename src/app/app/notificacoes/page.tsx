import Link from "@/components/ui/access-link";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { ActionButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { formatInstant } from "@/lib/dates";
import { markReadAction } from "./actions";

export const metadata = { title: "Notificações" };
export default async function NotificationsPage() {
  const ctx = await requireCtx();
  const rows = await ctx.db.notification.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <>
      <PageHeader title="Notificações" actions={<ActionButton action={markReadAction} fields={{}}>Marcar todas como lidas</ActionButton>} />
      {rows.length === 0 ? <EmptyState title="Sem notificações" /> : (
        <ul className="divide-y rounded-lg border bg-white">
          {rows.map((n) => (
            <li key={n.id} className={`p-3 text-sm ${n.readAt ? "" : "bg-brand-50"}`}>
              <div className="flex justify-between gap-2"><b>{n.title}</b><span className="text-xs text-slate-500">{formatInstant(n.createdAt, ctx.timezone)}</span></div>
              {n.body && <p className="text-slate-600">{n.body}</p>}
              {n.link && <Link className="text-brand-700 underline" href={n.link}>Abrir</Link>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
