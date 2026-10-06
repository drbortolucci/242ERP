import { PageHeader, Card } from "@/components/ui/page";
import { pagePerm } from "@/server/page-guard";
import { requireCtx } from "@/server/auth/next";
import { IMPORT_LAYOUTS } from "@/modules/imports/service";
import { lookups } from "@/modules/config/lookups";
import { ImportForm } from "./import-form";

export const metadata = { title: "Importar planilha" };
export default async function ImportPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "master.write");
  const companies = await lookups.companies(ctx);
  const layouts = Object.entries(IMPORT_LAYOUTS).map(([k, v]) => ({ value: k, label: v.title, columns: v.columns }));
  return (
    <>
      <PageHeader title="Importar cadastros por planilha" subtitle="Pré-visualize os erros antes de importar. Somente linhas válidas são gravadas, usando as mesmas validações do cadastro manual (inclusive duplicidade)." breadcrumbs={[{ label: "Cadastros" }, { label: "Importar" }]} />
      <Card><ImportForm companies={companies} layouts={layouts} /></Card>
    </>
  );
}
