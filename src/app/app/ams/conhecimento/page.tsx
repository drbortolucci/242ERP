import { PageHeader, Card, Badge } from "@/components/ui/page";
import { getTerms } from "@/modules/sectors/service";
import { DataTable, Toolbar } from "@/components/ui/table";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { searchArticles } from "@/modules/ams/knowledge";
import { sp, type SearchParams } from "@/lib/query";
import { ArticleForm } from "./article-form";

export const metadata = { title: "Base de conhecimento" };
export default async function KnowledgePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  const terms = await getTerms(ctx);
  pagePerm(ctx, "ams.read");
  const rows = await searchArticles(ctx, sp(s, "q") ?? "", { take: 100 });
  return (
    <>
      <PageHeader title="Base de conhecimento" breadcrumbs={[{ label: terms.supportArea }, { label: "Base de conhecimento" }]} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Toolbar base="/app/ams/conhecimento" params={s} filters={[]} />
          <DataTable rows={rows} rowHref={(a) => `/app/ams/conhecimento/${a.id}`} empty="Nenhum artigo encontrado." columns={[
            { key: "title", label: "Título" }, { key: "system", label: terms.systemField, render: (a) => a.system ?? "—" },
            { key: "tags", label: "Etiquetas", render: (a) => <span className="flex flex-wrap gap-1">{a.tags.map((t) => <Badge key={t}>{t}</Badge>)}</span> },
            { key: "v", label: "Visibilidade", render: (a) => (!a.published ? <Badge tone="slate">rascunho</Badge> : a.clientVisible ? <Badge tone="green">cliente</Badge> : <Badge tone="blue">interno</Badge>) },
            { key: "u", label: "Atualizado", render: (a) => a.updatedAt.toLocaleDateString("pt-BR", { timeZone: ctx.timezone }) },
          ]} />
        </div>
        {ctx.permissions.has("ams.write") && <Card title="Novo artigo"><ArticleForm systemLabel={terms.systemField} /></Card>}
      </div>
    </>
  );
}
