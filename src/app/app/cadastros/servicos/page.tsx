import { redirect } from "next/navigation";
import { PageHeader, StatusBadge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { SERVICE_CATEGORIES } from "@/domain/sectors";

export const metadata = { title: "Serviços" };
/** Quem configura vai ao cadastro editável; os demais perfis com acesso a cadastros consultam o catálogo. */
export default async function ServicesPage() {
  const ctx = await requireCtx();
  if (ctx.permissions.has("settings.manage")) redirect("/app/config/servicos");
  pagePerm(ctx, "master.read");
  const rows = await ctx.db.service.findMany({ orderBy: { code: "asc" } });
  const cat = new Map<string, string>(SERVICE_CATEGORIES.map((c) => [c.value, c.label]));
  return (
    <>
      <PageHeader title="Serviços" subtitle="Catálogo de serviços oferecidos (consulta). A manutenção é feita no Configurador." breadcrumbs={[{ label: "Cadastros" }, { label: "Serviços" }]} />
      <DataTable rows={rows} empty="Nenhum serviço cadastrado." columns={[
        { key: "code", label: "Código" }, { key: "name", label: "Nome" }, { key: "c", label: "Categoria", render: (r) => cat.get(r.category) ?? r.category },
        { key: "d", label: "Descrição", render: (r) => r.description ?? "—" }, { key: "a", label: "Situação", render: (r) => <StatusBadge status={r.active ? "ACTIVE" : "INACTIVE"} /> },
      ]} />
    </>
  );
}
