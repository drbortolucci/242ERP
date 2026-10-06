import { notFound } from "next/navigation";
import { PageHeader, Card, DefinitionList, StatusBadge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionForm, Input, Select, SubmitButton } from "@/components/ui/form";
import { requirePlatformAdmin } from "@/server/auth/next";
import { listOrganizations } from "@/modules/saas/platform";
import { prisma } from "@/server/db";
import { formatInstant } from "@/lib/dates";
import { orgStatusAction } from "../../actions";

export default async function OrgDetail({ params }: { params: Promise<{ id: string }> }) {
  const u = await requirePlatformAdmin();
  const { id } = await params;
  const org = (await listOrganizations(u.id)).find((o) => o.id === id);
  if (!org) notFound();
  const [changes, plans, platformAudit] = await Promise.all([
    prisma.planChange.findMany({ where: { organizationId: id }, orderBy: { createdAt: "desc" } }), prisma.plan.findMany(),
    prisma.auditLog.findMany({ where: { organizationId: id, action: { startsWith: "platform." } }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const pn = new Map(plans.map((p) => [p.id, p.name]));
  return (
    <>
      <PageHeader title={org.name} subtitle={<StatusBadge status={org.status} />} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Assinatura e uso agregado">
          <DefinitionList items={[{ label: "Plano", value: org.plan.name }, { label: "Assinatura", value: <StatusBadge status={org.subscription?.status} /> }, { label: "Usuários ativos", value: org.users }, { label: "Empresas", value: org.companies }, { label: "Armazenamento", value: `${(Number(org.storageUsedBytes) / 1048576).toFixed(1)} MB` }, { label: "Retenção até", value: formatInstant(org.retentionUntil) }]} />
        </Card>
        <Card title="Ação manual (auditada)">
          <ActionForm action={orgStatusAction}>
            <input type="hidden" name="orgId" value={id} />
            <Select name="status" label="Nova situação" options={[{ value: "SUSPENDED", label: "Suspender (somente leitura, dados preservados)" }, { value: "ACTIVE", label: "Reativar" }]} />
            <Input name="reason" label="Motivo" required />
            <SubmitButton variant="danger">Aplicar</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Histórico de plano" className="lg:col-span-2">
          <DataTable rows={changes} columns={[{ key: "createdAt", label: "Data", render: (c) => formatInstant(c.createdAt) }, { key: "kind", label: "Tipo" }, { key: "from", label: "De", render: (c) => (c.fromPlanId ? pn.get(c.fromPlanId) : "—") }, { key: "to", label: "Para", render: (c) => pn.get(c.toPlanId) }, { key: "reason", label: "Motivo", render: (c) => c.reason ?? "—" }]} />
        </Card>
        <Card title="Ações da plataforma nesta organização" className="lg:col-span-2">
          <DataTable rows={platformAudit} columns={[{ key: "createdAt", label: "Data", render: (a) => formatInstant(a.createdAt) }, { key: "action", label: "Ação" }]} empty={<p className="text-sm text-slate-500">Nenhuma.</p>} />
        </Card>
      </div>
    </>
  );
}
