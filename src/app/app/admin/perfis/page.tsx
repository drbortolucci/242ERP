import Link from "@/components/ui/access-link";
import { PageHeader, Card } from "@/components/ui/page";
import { ActionForm, Checkbox, Input, SubmitButton } from "@/components/ui/form";
import { pagePerm } from "@/server/page-guard";
import { requireCtx } from "@/server/auth/next";
import { PERMISSIONS } from "@/lib/permissions";
import { sp, type SearchParams } from "@/lib/query";
import { saveRoleAction } from "../usuarios/actions";

export const metadata = { title: "Perfis e permissões" };
const GROUPS: [string, string][] = [["org.", "Organização"], ["users.", "Usuários"], ["settings.", "Configurações"], ["company.", "Empresas"], ["audit.", "Auditoria"], ["data.", "Dados"], ["support.", "Suporte"], ["master.", "Cadastros"], ["cost.", "Custos"], ["margin.", "Margens"], ["crm.", "CRM"], ["proposal.", "Propostas"], ["contract.", "Contratos"], ["commission.", "Comissões"], ["project.", "Projetos"], ["resource.", "Recursos"], ["time.", "Horas"], ["expense.", "Despesas"], ["purchase.", "Compras"], ["inventory.", "Estoque"], ["fiscal.", "Fiscal"], ["accounting.", "Contabilidade"], ["sales.", "Vendas de produtos"], ["ams.", "Atendimento (AMS)"], ["billing.", "Faturamento"], ["finance.", "Financeiro"], ["payable.", "Pagar"], ["payment.", "Liquidações"], ["treasury.", "Tesouraria"], ["offset.", "Compensações"], ["controlling.", "Controladoria"], ["period.", "Períodos"], ["portal.", "Portal"]];

export default async function RolesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireCtx();
  pagePerm(ctx, "users.manage");
  const sel = sp(await searchParams, "perfil");
  const roles = await ctx.db.role.findMany({ orderBy: { name: "asc" } });
  const entries = Object.entries(PERMISSIONS);
  // Apenas o perfil selecionado é renderizado com o formulário completo (página leve, uma lista de permissões por vez).
  const selected = sel === "novo" ? null : roles.find((r) => r.id === sel);
  return (
    <>
      <PageHeader title="Perfis e permissões" subtitle="Permissões por ação e módulo. O escopo de empresas e o cliente do portal são definidos por usuário. Alterações são auditadas." breadcrumbs={[{ label: "Usuários", href: "/app/admin/usuarios" }, { label: "Perfis" }]} />
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <nav aria-label="Perfis" className="space-y-1 text-sm">
          {roles.map((r) => <Link key={r.id} href={`?perfil=${r.id}`} className={`block rounded border px-3 py-2 ${r.id === selected?.id ? "border-brand-600 bg-brand-50 font-medium" : "bg-white hover:bg-slate-50"}`}>{r.name} <span className="text-xs text-slate-500">({r.permissions.length} permissões{r.key === "org_admin" ? ", não editável" : ""})</span></Link>)}
          <Link href="?perfil=novo" className={`block rounded border px-3 py-2 ${sel === "novo" ? "border-brand-600 bg-brand-50 font-medium" : "bg-white hover:bg-slate-50"}`}>+ Novo perfil</Link>
        </nav>
        {sel === undefined || (sel !== "novo" && !selected) ? <p className="text-sm text-slate-500">Selecione um perfil para ver ou editar as permissões.</p> : [selected ?? null].map((r) => (
          <div key={r?.id ?? "new"}>
            <Card title={r ? r.name : "Novo perfil"}>
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
          </div>
        ))}
      </div>
    </>
  );
}
