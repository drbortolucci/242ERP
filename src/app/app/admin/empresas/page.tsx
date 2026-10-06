import { PageHeader, Card, StatusBadge, Notice } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionButton } from "@/components/ui/form";
import { pagePerm } from "@/server/page-guard";
import { requireCtx } from "@/server/auth/next";
import { listCompanies } from "@/modules/companies/service";
import { getUsage } from "@/modules/saas/limits";
import { formatDocument } from "@/lib/documents";
import { CompanyForm } from "./company-form";
import { createCompanyAction, toggleCompanyAction } from "./actions";

export const metadata = { title: "Empresas" };

export default async function CompaniesPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "company.manage");
  const [companies, usage] = await Promise.all([listCompanies(ctx), getUsage(ctx.orgId)]);
  const parents = companies.filter((c) => c.kind === "HEADQUARTERS").map((c) => ({ value: c.id, label: c.legalName }));
  return (
    <>
      <PageHeader title="Empresas e filiais" subtitle={`Entidades jurídicas da organização. Uso do plano: ${usage.companies} de ${usage.limits.companies} empresa(s) ativa(s).`} breadcrumbs={[{ label: "Administração" }, { label: "Empresas" }]} />
      <div className="space-y-6">
        <DataTable rows={companies} rowHref={(c) => `/app/admin/empresas/${c.id}`} columns={[
          { key: "legalName", label: "Razão social" },
          { key: "tradeName", label: "Nome fantasia", render: (c) => c.tradeName ?? "—" },
          { key: "cnpj", label: "CNPJ", render: (c) => formatDocument(c.cnpj) },
          { key: "kind", label: "Tipo", render: (c) => (c.kind === "BRANCH" ? "Filial" : "Matriz") },
          { key: "taxRegime", label: "Regime informado", render: (c) => c.taxRegime ?? "—" },
          { key: "active", label: "Situação", render: (c) => <StatusBadge status={c.active ? "ACTIVE" : "INACTIVE"} /> },
          { key: "act", label: "", render: (c) => <ActionButton action={toggleCompanyAction} fields={{ id: c.id, active: c.active ? "false" : "true" }} confirm={c.active ? "Inativar empresa? Os dados são preservados." : undefined}>{c.active ? "Inativar" : "Reativar"}</ActionButton> },
        ]} />
        <Card title="Nova empresa ou filial">
          {usage.companies >= usage.limits.companies && <div className="mb-3"><Notice tone="warn">Limite de empresas do plano atingido. Faça upgrade em Assinatura e plano.</Notice></div>}
          <CompanyForm action={createCompanyAction} parents={parents} submitLabel="Cadastrar empresa" />
        </Card>
      </div>
    </>
  );
}
