import { PageHeader, Card } from "@/components/ui/page";
import { ActionForm, Checkbox, Input, SubmitButton } from "@/components/ui/form";
import { pagePerm } from "@/server/page-guard";
import { requireCtx } from "@/server/auth/next";
import { PERMISSIONS } from "@/lib/permissions";
import { saveRoleAction } from "../usuarios/actions";

export const metadata = { title: "Perfis e permissões" };
const GROUPS: [string, string][] = [["org.", "Organização"], ["users.", "Usuários"], ["settings.", "Configurações"], ["company.", "Empresas"], ["audit.", "Auditoria"], ["data.", "Dados"], ["support.", "Suporte"], ["master.", "Cadastros"], ["cost.", "Custos"], ["margin.", "Margens"], ["crm.", "CRM"], ["proposal.", "Propostas"], ["contract.", "Contratos"], ["commission.", "Comissões"], ["project.", "Projetos"], ["resource.", "Recursos"], ["time.", "Horas"], ["expense.", "Despesas"], ["purchase.", "Compras"], ["ams.", "AMS"], ["billing.", "Faturamento"], ["finance.", "Financeiro"], ["payable.", "Pagar"], ["payment.", "Liquidações"], ["treasury.", "Tesouraria"], ["offset.", "Compensações"], ["controlling.", "Controladoria"], ["period.", "Períodos"], ["portal.", "Portal"]];

export default async function RolesPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "users.manage");
  const roles = await ctx.db.role.findMany({ orderBy: { name: "asc" } });
  const entries = Object.entries(PERMISSIONS);
  return (
    <>
      <PageHeader title="Perfis e permissões" subtitle="Permissões por ação e módulo. O escopo de empresas e o cliente do portal são definidos por usuário. Alterações são auditadas." breadcrumbs={[{ label: "Usuários", href: "/app/admin/usuarios" }, { label: "Perfis" }]} />
      <div className="space-y-4">
        {[...roles, null].map((r) => (
          <details key={r?.id ?? "new"} className="rounded-lg border bg-white p-3">
            <summary className="cursor-pointer font-medium">{r ? `${r.name} (${r.permissions.length} permissões)` : "+ Novo perfil"}{r?.key === "org_admin" && " — não editável"}</summary>
            <Card className="mt-3">
              <ActionForm action={saveRoleAction}>
                {r && <input type="hidden" name="id" value={r.id} />}
                <Input name="name" label="Nome" defaultValue={r?.name ?? ""} required />
                <Input name="description" label="Descrição" defaultValue={r?.description ?? ""} />
                <div className="grid gap-x-6 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
                  {GROUPS.map(([prefix, label]) => {
                    const items = entries.filter(([k]) => k.startsWith(prefix));
                    if (!items.length) return null;
                    return (
                      <fieldset key={prefix} className="py-1"><legend className="text-xs font-semibold text-slate-500">{label}</legend>
                        {items.map(([k, d]) => <Checkbox key={k} name="permissions[]" value={k} label={d} defaultChecked={r?.permissions.includes(k)} />)}
                      </fieldset>
                    );
                  })}
                </div>
                {r?.key !== "org_admin" && <SubmitButton>Salvar perfil</SubmitButton>}
              </ActionForm>
            </Card>
          </details>
        ))}
      </div>
    </>
  );
}
