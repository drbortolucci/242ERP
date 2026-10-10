import Link from "@/components/ui/access-link";
import { PageHeader, Card } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { nameMap } from "@/modules/config/lookups";
import { formatInstant } from "@/lib/dates";
import { ActivityForm } from "../activity-form";
import { ACTIVITY_TYPES } from "../constants";
import { completeActivityAction } from "../actions";

export const metadata = { title: "Atividades" };
export default async function ActivitiesPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "crm.read");
  const [pending, recent] = await Promise.all([
    ctx.db.activity.findMany({ where: { ownerUserId: ctx.userId, doneAt: null }, orderBy: { dueAt: "asc" }, take: 100 }),
    ctx.db.activity.findMany({ where: { doneAt: { not: null } }, orderBy: { doneAt: "desc" }, take: 30 }),
  ]);
  const parties = await nameMap(ctx, "party", [...pending, ...recent].map((a) => a.partyId));
  const now = new Date();
  const cols = [
    { key: "type", label: "Tipo", render: (a: (typeof pending)[number]) => ACTIVITY_TYPES.find((t) => t.value === a.type)?.label },
    { key: "subject", label: "Assunto", render: (a: (typeof pending)[number]) => a.opportunityId ? <Link className="text-brand-700 underline" href={`/app/crm/oportunidades/${a.opportunityId}`}>{a.subject}</Link> : a.subject },
    { key: "party", label: "Cliente", render: (a: (typeof pending)[number]) => parties.get(a.partyId ?? "") ?? "—" },
  ];
  return (
    <>
      <PageHeader title="Atividades, tarefas e reuniões" breadcrumbs={[{ label: "Comercial" }, { label: "Atividades" }]} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title={`Minhas pendências (${pending.length})`}>
            <DataTable rows={pending} columns={[...cols, { key: "dueAt", label: "Quando", render: (a) => <span className={a.dueAt && a.dueAt < now ? "font-medium text-red-700" : ""}>{formatInstant(a.dueAt, ctx.timezone)}</span> }, { key: "x", label: "", render: (a) => <ActionButton action={completeActivityAction} fields={{ id: a.id }}>Concluir</ActionButton> }]} />
          </Card>
          <Card title="Histórico recente de interações"><DataTable rows={recent} columns={[...cols, { key: "doneAt", label: "Realizada", render: (a) => formatInstant(a.doneAt, ctx.timezone) }]} /></Card>
        </div>
        {ctx.permissions.has("crm.write") && <Card title="Nova atividade"><ActivityForm back="/app/crm/atividades" /></Card>}
      </div>
    </>
  );
}
