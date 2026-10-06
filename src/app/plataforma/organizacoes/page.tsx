import { PageHeader, StatusBadge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { requirePlatformAdmin } from "@/server/auth/next";
import { listOrganizations } from "@/modules/saas/platform";
import { formatInstant } from "@/lib/dates";

export default async function OrgsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const u = await requirePlatformAdmin();
  const status = (await searchParams).status;
  const orgs = (await listOrganizations(u.id)).filter((o) => !status || o.status === status);
  return (
    <>
      <PageHeader title="Organizações" subtitle={status ? `Filtro: ${status}` : "Todas"} />
      <DataTable rows={orgs} rowHref={(o) => `/plataforma/organizacoes/${o.id}`} columns={[
        { key: "name", label: "Organização" }, { key: "plan", label: "Plano", render: (o) => o.plan.name }, { key: "status", label: "Situação", render: (o) => <StatusBadge status={o.status} /> },
        { key: "users", label: "Usuários", align: "right" }, { key: "companies", label: "Empresas", align: "right" },
        { key: "trial", label: "Avaliação até", render: (o) => formatInstant(o.trialEndsAt) }, { key: "createdAt", label: "Criada", render: (o) => formatInstant(o.createdAt) },
      ]} />
    </>
  );
}
