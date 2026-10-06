import { PageHeader, Card, Notice } from "@/components/ui/page";
import { ActionForm, Checkbox, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import { pagePerm } from "@/server/page-guard";
import { requireCtx } from "@/server/auth/next";
import { INTEGRATION_KINDS } from "@/modules/config/special";
import { appEnv, externalActionsAllowed } from "@/server/providers/env";
import { saveIntegrationAction } from "../special-actions";

export default async function IntegrationsPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "settings.manage");
  const cfgs = await ctx.db.integrationConfig.findMany();
  return (
    <>
      <PageHeader title="Integrações" subtitle="Adaptadores documentados em docs/INTEGRACOES.md. Credenciais ficam no cofre do ambiente; aqui se informa apenas o nome do segredo." breadcrumbs={[{ label: "Configurador", href: "/app/config" }, { label: "Integrações" }]} />
      <div className="mb-4"><Notice tone={externalActionsAllowed() ? "warn" : "info"}>Ambiente atual: <b>{appEnv()}</b>. {externalActionsAllowed() ? "Ações externas reais habilitadas." : "Todas as integrações operam em modo SIMULADO — nenhuma mensagem, cobrança ou nota real é emitida."}</Notice></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {INTEGRATION_KINDS.map((k) => {
          const c = cfgs.find((x) => x.kind === k.kind);
          return (
            <Card key={k.kind} title={k.label}>
              <ActionForm action={saveIntegrationAction}>
                <input type="hidden" name="kind" value={k.kind} />
                <FormGrid cols={2}>
                  <Select name="provider" label="Provedor" options={k.providers.map((p) => ({ value: p, label: p }))} defaultValue={c?.provider ?? k.providers[0]} />
                  <Select name="environment" label="Ambiente" options={[{ value: "SANDBOX", label: "Homologação" }, { value: "PRODUCTION", label: "Produção" }]} defaultValue={c?.environment ?? "SANDBOX"} />
                </FormGrid>
                <Input name="secretRef" label="Nome do segredo (ex.: NFSE_API_KEY)" defaultValue={c?.secretRef ?? ""} />
                <Checkbox name="enabled" label="Habilitada" defaultChecked={c?.enabled ?? false} />
                <SubmitButton variant="secondary">Salvar</SubmitButton>
              </ActionForm>
            </Card>
          );
        })}
      </div>
    </>
  );
}
