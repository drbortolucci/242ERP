import Link from "@/components/ui/access-link";
import { PageHeader, Card, StatusBadge, Badge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionButton, ActionForm, Checkbox, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { listMembers } from "@/modules/users/service";
import { getUsage } from "@/modules/saas/limits";
import { lookups } from "@/modules/config/lookups";
import { formatInstant } from "@/lib/dates";
import { inviteAction, revokeInvitationAction, toggleMembershipAction } from "./actions";

export const metadata = { title: "Usuários" };

export default async function UsersPage() {
  const ctx = await requireCtx();
  const [members, roles, invites, usage, companies, customers] = await Promise.all([
    listMembers(ctx), ctx.db.role.findMany({ orderBy: { name: "asc" } }), ctx.db.invitation.findMany({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
    getUsage(ctx.orgId), lookups.companies(ctx), lookups.customers(ctx),
  ]);
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  return (
    <>
      <PageHeader title="Usuários e acessos" subtitle={`Usuários internos: ${usage.users} ativos + ${usage.pendingInvites} convites pendentes de ${usage.limits.users} do plano ${usage.plan.name}. Usuários do portal do cliente não consomem licença.`}
        breadcrumbs={[{ label: "Administração" }, { label: "Usuários" }]} actions={<Link className="text-sm text-brand-700 underline" href="/app/admin/perfis">Perfis e permissões</Link>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <DataTable rows={members} rowHref={(m) => `/app/admin/usuarios/${m.id}`} columns={[
            { key: "name", label: "Usuário", render: (m) => <span>{m.user.name}<span className="block text-xs text-slate-500">{m.user.email}</span></span> },
            { key: "kind", label: "Tipo", render: (m) => (m.kind === "CLIENT" ? <Badge tone="violet">Portal do cliente</Badge> : <Badge>Interno</Badge>) },
            { key: "roles", label: "Perfis", render: (m) => m.roleIds.map((r) => roleName.get(r)).join(", ") },
            { key: "scope", label: "Empresas", render: (m) => (m.allCompanies ? "Todas" : `${m.companyIds.length} empresa(s)`) },
            { key: "mfa", label: "MFA", render: (m) => (m.user.mfaEnabled ? "Ativo" : "—") },
            { key: "last", label: "Último acesso", render: (m) => formatInstant(m.user.lastLoginAt, ctx.timezone) },
            { key: "active", label: "Situação", render: (m) => <StatusBadge status={m.active ? "ACTIVE" : "INACTIVE"} /> },
            { key: "act", label: "", render: (m) => m.userId !== ctx.userId && <ActionButton action={toggleMembershipAction} fields={{ id: m.id, active: m.active ? "false" : "true" }} confirm={m.active ? "Desativar acesso deste usuário?" : undefined}>{m.active ? "Desativar" : "Reativar"}</ActionButton> },
          ]} />
          <Card title={`Convites pendentes (${invites.length})`}>
            {invites.length === 0 ? <p className="text-sm text-slate-500">Nenhum convite pendente.</p> : (
              <ul className="divide-y text-sm">{invites.map((i) => <li key={i.id} className="flex items-center justify-between py-2"><span>{i.email} · expira {formatInstant(i.expiresAt, ctx.timezone)}</span><ActionButton action={revokeInvitationAction} fields={{ id: i.id }} variant="danger">Revogar</ActionButton></li>)}</ul>
            )}
          </Card>
        </div>
        <Card title="Convidar usuário">
          <ActionForm action={inviteAction} resetOnSuccess>
            <Input name="email" type="email" label="E-mail" required />
            <Select name="kind" label="Tipo de acesso" options={[{ value: "INTERNAL", label: "Interno (colaborador)" }, { value: "CLIENT", label: "Portal do cliente" }]} />
            <Select name="partyId" label="Cliente (para portal)" options={customers} placeholder="—" />
            <fieldset><legend className="mb-1 text-xs font-medium">Perfis</legend><div className="space-y-1">{roles.map((r) => <Checkbox key={r.id} name="roleIds[]" value={r.id} label={r.name} />)}</div></fieldset>
            <fieldset><legend className="mb-1 text-xs font-medium">Escopo de empresas</legend>
              <Checkbox name="allCompanies" label="Todas as empresas" defaultChecked />
              <FormGrid cols={1}>{companies.map((c) => <Checkbox key={c.value} name="companyIds[]" value={c.value} label={c.label} />)}</FormGrid>
            </fieldset>
            <SubmitButton>Enviar convite</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
