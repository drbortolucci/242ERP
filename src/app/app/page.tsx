import Link from "next/link";
import { PageHeader, Card, Notice, Stat, Grid } from "@/components/ui/page";
import { requireCtx } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { dashboardFor } from "@/modules/dashboard/service";

export const metadata = { title: "Painel" };

export default async function Dashboard() {
  const ctx = await requireCtx();
  const [org, sections] = await Promise.all([prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId } }), dashboardFor(ctx)]);
  return (
    <>
      <PageHeader title={`Olá, ${ctx.userName.split(" ")[0]}`} subtitle={ctx.orgName} />
      {!org.onboardingDone && ctx.permissions.has("settings.manage") && (
        <div className="mb-6"><Notice tone="info">Conclua a <Link className="font-medium underline" href="/app/onboarding">configuração inicial da empresa</Link> para começar a operar.</Notice></div>
      )}
      <div className="space-y-6">
        {sections.map((s) => (
          <section key={s.key} aria-labelledby={`dash-${s.key}`}>
            <h2 id={`dash-${s.key}`} className="mb-2 text-sm font-semibold text-slate-700">{s.title}</h2>
            <Grid cols={4}>{s.metrics.map((m) => <Stat key={m.label} label={m.label} value={m.value} hint={m.hint} href={m.href} tone={m.tone} />)}</Grid>
          </section>
        ))}
        {sections.length === 0 && <Card title="Painel"><p className="text-sm text-slate-600">Seu perfil ainda não possui indicadores. Use o menu para acessar suas tarefas.</p></Card>}
      </div>
    </>
  );
}
