import { PageHeader, Grid, Stat, Card, Notice } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { requirePlatformAdmin } from "@/server/auth/next";
import { platformMetrics, grantsForPlatformUser } from "@/modules/saas/platform";
import { formatMoney } from "@/lib/money";
import { formatInstant } from "@/lib/dates";
import { supportSessionAction } from "./actions";

export default async function PlatformHome() {
  const u = await requirePlatformAdmin();
  const [m, grants] = await Promise.all([platformMetrics(u.id), grantsForPlatformUser(u.id)]);
  return (
    <>
      <PageHeader title="Métricas da plataforma" subtitle="Dados de assinatura e uso agregado. Dados empresariais das organizações não são acessíveis daqui." />
      <Grid cols={4}>
        <Stat label="MRR (assinaturas ativas)" value={formatMoney(m.mrr)} href="/plataforma/organizacoes" />
        <Stat label="Receita recebida 30 dias" value={formatMoney(m.revenue30d)} />
        <Stat label="Ativas" value={m.byStatus.ACTIVE ?? 0} href="/plataforma/organizacoes?status=ACTIVE" />
        <Stat label="Em avaliação" value={m.byStatus.TRIAL ?? 0} hint={`${m.trialsEnding} terminam em 7 dias`} href="/plataforma/organizacoes?status=TRIAL" />
        <Stat label="Inadimplentes" value={m.byStatus.PAST_DUE ?? 0} tone={(m.byStatus.PAST_DUE ?? 0) > 0 ? "warn" : "default"} href="/plataforma/organizacoes?status=PAST_DUE" />
        <Stat label="Suspensas" value={m.byStatus.SUSPENDED ?? 0} tone={(m.byStatus.SUSPENDED ?? 0) > 0 ? "bad" : "default"} href="/plataforma/organizacoes?status=SUSPENDED" />
        <Stat label="Canceladas" value={m.byStatus.CANCELED ?? 0} href="/plataforma/organizacoes?status=CANCELED" />
        <Stat label="Novas (30 dias)" value={m.newOrgs} />
        <Stat label="Jobs com falha" value={m.failedJobs} tone={m.failedJobs ? "bad" : "good"} />
        <Stat label="Webhooks com erro" value={m.webhookErrors} tone={m.webhookErrors ? "bad" : "good"} />
      </Grid>
      <div className="mt-6">
        <Card title="Acessos de suporte autorizados para você">
          {grants.length === 0 ? <Notice tone="info">Nenhuma organização autorizou seu acesso. A autorização é concedida pelo administrador da organização, com prazo.</Notice> : (
            <ul className="space-y-2 text-sm">{grants.map((g) => (
              <li key={g.id} className="flex items-center justify-between rounded border p-2"><span><b>{g.orgName}</b> — {g.reason} (até {formatInstant(g.expiresAt)})</span>
                <ActionForm action={supportSessionAction}><input type="hidden" name="orgId" value={g.organizationId} /><SubmitButton variant="secondary">Entrar (somente leitura)</SubmitButton></ActionForm></li>
            ))}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
