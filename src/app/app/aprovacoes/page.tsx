import Link from "@/components/ui/access-link";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { requireCtx } from "@/server/auth/next";
import { pendingForUser, approvalHandler } from "@/modules/approvals/service";
import "@/modules/approvals/register-all";
import { userNameMap } from "@/modules/config/lookups";
import { formatInstant } from "@/lib/dates";
import { DecideForm } from "@/components/decide-form";

export const metadata = { title: "Aprovações" };

export default async function ApprovalsPage() {
  const ctx = await requireCtx();
  const rows = await pendingForUser(ctx);
  const users = await userNameMap(rows.map((r) => r.requestedById));
  // Horas e despesas pendentes têm filas próprias
  const [timeCount, expenseCount] = await Promise.all([
    ctx.permissions.has("time.approve") ? ctx.db.timeEntry.count({ where: { status: "SUBMITTED" } }) : 0,
    ctx.permissions.has("expense.approve") ? ctx.db.expense.count({ where: { status: "SUBMITTED" } }) : 0,
  ]);
  return (
    <>
      <PageHeader title="Aprovações pendentes" subtitle="Somente itens dentro da sua alçada. Pela segregação de funções, solicitações suas não aparecem aqui." breadcrumbs={[{ label: "Início", href: "/app" }, { label: "Aprovações" }]} />
      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        {ctx.permissions.has("time.approve") && <Link className="rounded border bg-white px-3 py-2 hover:border-brand-500" href="/app/horas/aprovacao">Horas aguardando aprovação: <b>{timeCount}</b></Link>}
        {ctx.permissions.has("expense.approve") && <Link className="rounded border bg-white px-3 py-2 hover:border-brand-500" href="/app/despesas?status=SUBMITTED">Despesas aguardando aprovação: <b>{expenseCount}</b></Link>}
      </div>
      {rows.length === 0 ? <EmptyState title="Nada pendente para você" /> : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const h = approvalHandler(r.entity);
            return (
              <li key={r.id} className="rounded-lg border bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><b>{h?.label ?? r.entity}</b> · <Link className="text-brand-700 underline" href={h?.link(r.entityId) ?? "#"}>abrir documento</Link></div>
                  <span className="text-xs text-slate-500">Nível {r.level} · solicitado por {users.get(r.requestedById)} em {formatInstant(r.createdAt, ctx.timezone)}</span>
                </div>
                <p className="mt-1 text-sm text-slate-700">{r.reasons.join("; ")}</p>
                <DecideForm id={r.id} />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
