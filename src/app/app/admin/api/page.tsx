import { PageHeader, Card, Notice, Badge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionButton, ActionForm, Checkbox, Input, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { userNameMap } from "@/modules/config/lookups";
import { API_SCOPES } from "@/modules/api/service";
import { formatInstant } from "@/lib/dates";
import { createApiKeyAction, revokeApiKeyAction } from "./actions";

export const metadata = { title: "API" };
export default async function ApiKeysPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "settings.manage");
  const keys = await ctx.db.apiKey.findMany({ orderBy: { createdAt: "desc" } });
  const users = await userNameMap(keys.map((k) => k.createdById));
  const enabled = ctx.planModules.includes("api");
  return (
    <>
      <PageHeader title="Chaves de API" subtitle="Integração REST/JSON (docs/INTEGRACOES.md). A chave é exibida uma única vez e guardada apenas como hash." breadcrumbs={[{ label: "Administração" }, { label: "API" }]} />
      {!enabled && <div className="mb-4"><Notice tone="warn">A API não está incluída no plano atual da organização.</Notice></div>}
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Chaves" className="xl:col-span-2">
          <DataTable dense rows={keys} empty="Nenhuma chave criada." columns={[
            { key: "name", label: "Nome" }, { key: "p", label: "Prefixo", render: (k) => <code>erp_{k.prefix}_…</code> },
            { key: "s", label: "Escopos", render: (k) => <span className="flex flex-wrap gap-1">{k.scopes.map((s) => <Badge key={s}>{s}</Badge>)}</span> },
            { key: "u", label: "Último uso", render: (k) => formatInstant(k.lastUsedAt, ctx.timezone) }, { key: "c", label: "Criada por", render: (k) => users.get(k.createdById) },
            { key: "st", label: "Situação", render: (k) => (k.revokedAt ? <Badge tone="red">revogada</Badge> : <Badge tone="green">ativa</Badge>) },
            { key: "x", label: "", render: (k) => (!k.revokedAt ? <ActionButton action={revokeApiKeyAction} fields={{ id: k.id }} variant="danger" confirm="Revogar a chave? Integrações que a usam deixarão de funcionar.">Revogar</ActionButton> : null) },
          ]} />
        </Card>
        {enabled && (
          <Card title="Nova chave">
            <ActionForm action={createApiKeyAction} resetOnSuccess>
              <Input name="name" label="Nome (ex.: Integração ITSM)" required />
              <fieldset className="space-y-1"><legend className="text-xs font-medium">Escopos</legend>{Object.entries(API_SCOPES).map(([k, v]) => <Checkbox key={k} name="scopes[]" value={k} label={`${k} — ${v.label}`} />)}</fieldset>
              <SubmitButton>Criar chave</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
