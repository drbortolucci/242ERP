import { PageHeader, Card, DefinitionList, StatusBadge, Notice, SimulatedBanner } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionButton, ActionForm, Input, SubmitButton } from "@/components/ui/form";
import { pagePerm } from "@/server/page-guard";
import { requireCtx } from "@/server/auth/next";
import { getSubscription } from "@/modules/saas/subscription";
import { getUsage } from "@/modules/saas/limits";
import { prisma } from "@/server/db";
import { formatMoney } from "@/lib/money";
import { formatInstant } from "@/lib/dates";
import { paymentProvider } from "@/server/providers/payments";
import { activateAction, changePlanAction, cancelAction, reactivateAction } from "./actions";

export const metadata = { title: "Assinatura" };
const KIND: Record<string, string> = { INITIAL: "Contratação", UPGRADE: "Upgrade", DOWNGRADE: "Downgrade", CANCEL: "Cancelamento", REACTIVATE: "Reativação" };

export default async function SubscriptionPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "org.manage");
  const [{ sub, changes, plans }, usage, org] = await Promise.all([getSubscription(ctx.orgId), getUsage(ctx.orgId), prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId } })]);
  const planName = new Map(plans.map((p) => [p.id, p.name]));
  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
  return (
    <>
      <PageHeader title="Assinatura e plano" subtitle="Cobrança da plataforma 242ERP à sua organização — separada do faturamento dos seus serviços." breadcrumbs={[{ label: "Administração" }, { label: "Assinatura" }]} />
      {paymentProvider().name === "simulated" && <div className="mb-4"><SimulatedBanner what="provedor de pagamento de assinaturas" /></div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Situação" className="lg:col-span-2">
          <DefinitionList items={[
            { label: "Plano", value: sub?.plan.name }, { label: "Situação da organização", value: <StatusBadge status={org.status} /> }, { label: "Assinatura", value: <StatusBadge status={sub?.status} /> },
            { label: "Valor mensal", value: sub ? formatMoney(sub.plan.priceMonthly) : "—" }, { label: "Período atual até", value: formatInstant(sub?.currentPeriodEnd, ctx.timezone) },
            { label: "Avaliação até", value: formatInstant(org.trialEndsAt, ctx.timezone) },
            { label: "Usuários", value: `${usage.users} / ${usage.limits.users}` }, { label: "Empresas", value: `${usage.companies} / ${usage.limits.companies}` }, { label: "Armazenamento", value: `${mb(usage.storageBytes)} / ${usage.plan.maxStorageMb} MB` },
            { label: "Downgrade agendado", value: sub?.pendingPlanId ? planName.get(sub.pendingPlanId) : "—" }, { label: "Cancelamento ao fim do período", value: sub?.cancelAtPeriodEnd ? "Sim" : "Não" },
            { label: "Retenção de dados até", value: formatInstant(org.retentionUntil, ctx.timezone) },
          ]} />
          <div className="mt-4 flex flex-wrap gap-2">
            {(sub?.status === "TRIALING" || sub?.status === "PAST_DUE") && <ActionButton action={activateAction} fields={{}} variant="primary">Ativar assinatura paga</ActionButton>}
            {(sub?.cancelAtPeriodEnd || org.status === "CANCELED" || org.status === "SUSPENDED") && <ActionButton action={reactivateAction} fields={{}} variant="primary">Reativar</ActionButton>}
          </div>
          {org.status === "SUSPENDED" && <div className="mt-3"><Notice tone="error">Organização suspensa por inadimplência conforme política (carência configurada). Os dados estão preservados em modo somente leitura.</Notice></div>}
        </Card>
        <Card title="Mudar de plano">
          <p className="mb-2 text-xs text-slate-600">Upgrade: imediato. Downgrade: somente se o uso atual couber no plano de destino; vale no próximo ciclo.</p>
          <ul className="space-y-2">
            {plans.map((p) => (
              <li key={p.id} className="rounded border p-2 text-sm">
                <b>{p.name}</b> — {formatMoney(p.priceMonthly)}/mês<br /><span className="text-xs text-slate-500">{p.maxUsers} usuários · {p.maxCompanies} empresas · {p.maxStorageMb} MB · módulos: {p.modules.join(", ")}</span>
                {p.id !== sub?.planId && <div className="mt-1"><ActionButton action={changePlanAction} fields={{ planId: p.id }} confirm={`Mudar para o plano ${p.name}?`}>Escolher</ActionButton></div>}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Faturas da assinatura" className="lg:col-span-2">
          <DataTable rows={sub?.invoices ?? []} columns={[{ key: "periodStart", label: "Período", render: (i) => `${formatInstant(i.periodStart, ctx.timezone)} – ${formatInstant(i.periodEnd, ctx.timezone)}` }, { key: "amount", label: "Valor", align: "right", render: (i) => formatMoney(i.amount) }, { key: "status", label: "Situação", render: (i) => <StatusBadge status={i.status === "FAILED" ? "REJECTED" : i.status} /> }]} empty={<p className="text-sm text-slate-500">Nenhuma fatura.</p>} />
          <h3 className="mb-2 mt-6 text-sm font-semibold">Histórico de alterações de plano</h3>
          <DataTable rows={changes} columns={[{ key: "createdAt", label: "Data", render: (c) => formatInstant(c.createdAt, ctx.timezone) }, { key: "kind", label: "Tipo", render: (c) => KIND[c.kind] ?? c.kind }, { key: "from", label: "De", render: (c) => (c.fromPlanId ? planName.get(c.fromPlanId) : "—") }, { key: "to", label: "Para", render: (c) => planName.get(c.toPlanId) }, { key: "effectiveAt", label: "Vigência", render: (c) => formatInstant(c.effectiveAt, ctx.timezone) }, { key: "reason", label: "Motivo", render: (c) => c.reason ?? "—" }]} />
        </Card>
        {sub?.status !== "CANCELED" && !sub?.cancelAtPeriodEnd && (
          <Card title="Cancelar assinatura">
            <p className="mb-2 text-xs text-slate-600">Durante a avaliação o cancelamento é imediato; com assinatura paga, ocorre ao fim do período. Os dados ficam retidos por 90 dias para exportação e reativação, e nunca são excluídos automaticamente sem processo próprio.</p>
            <ActionForm action={cancelAction}><Input name="reason" label="Motivo" required /><SubmitButton variant="danger" confirm="Confirmar cancelamento da assinatura?">Cancelar assinatura</SubmitButton></ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
