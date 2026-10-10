import { notFound } from "next/navigation";
import { PageHeader, Card } from "@/components/ui/page";
import { ActionForm, Checkbox, Select, SubmitButton } from "@/components/ui/form";
import { pagePerm } from "@/server/page-guard";
import { requireCtx } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { lookups } from "@/modules/config/lookups";
import { updateMembershipAction } from "../actions";

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  pagePerm(ctx, "users.manage");
  const m = await ctx.db.membership.findFirst({ where: { id } });
  if (!m) notFound();
  const [user, roles, companies, professionals] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id: m.userId } }), ctx.db.role.findMany({ orderBy: { name: "asc" } }), lookups.companies(ctx), lookups.professionals(ctx)]);
  const allowed = m.kind === "CLIENT" ? roles.filter((r) => r.permissions.every((p) => p.startsWith("portal."))) : roles;
  return (
    <>
      <PageHeader title={user.name} subtitle={user.email} breadcrumbs={[{ label: "Usuários", href: "/app/admin/usuarios" }, { label: user.name }]} />
      <Card title="Perfis e escopo de dados">
        <ActionForm action={updateMembershipAction}>
          <input type="hidden" name="id" value={id} />
          <fieldset><legend className="mb-1 text-xs font-medium">Perfis</legend><div className="grid gap-1 md:grid-cols-3">{allowed.map((r) => <Checkbox key={r.id} name="roleIds[]" value={r.id} label={r.name} defaultChecked={m.roleIds.includes(r.id)} />)}</div></fieldset>
          <fieldset><legend className="mb-1 text-xs font-medium">Empresas</legend>
            <Checkbox name="allCompanies" label="Todas as empresas" defaultChecked={m.allCompanies} />
            <div className="mt-1 grid gap-1 md:grid-cols-3">{companies.map((c) => <Checkbox key={c.value} name="companyIds[]" value={c.value} label={c.label} defaultChecked={m.companyIds.includes(c.value)} />)}</div>
          </fieldset>
          {m.kind === "INTERNAL" && <Select name="professionalId" label="Profissional vinculado (horas, despesas, minha área)" options={professionals} placeholder="—" defaultValue={m.professionalId ?? ""} />}
          <SubmitButton>Salvar</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
