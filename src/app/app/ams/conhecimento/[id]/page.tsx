import { notFound } from "next/navigation";
import { PageHeader, Card, Badge } from "@/components/ui/page";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { ArticleForm } from "../article-form";

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  pagePerm(ctx, "ams.read");
  const a = await ctx.db.knowledgeArticle.findFirst({ where: { id } });
  if (!a) notFound();
  return (
    <>
      <PageHeader title={a.title} subtitle={<span className="flex gap-1">{a.system && <Badge tone="violet">{a.system}</Badge>}{a.tags.map((t) => <Badge key={t}>{t}</Badge>)}{a.clientVisible && <Badge tone="green">visível ao cliente</Badge>}</span>} breadcrumbs={[{ label: "Base de conhecimento", href: "/app/ams/conhecimento" }, { label: a.title }]} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Conteúdo" className="xl:col-span-2"><div className="whitespace-pre-wrap text-sm leading-6">{a.body}</div></Card>
        {ctx.permissions.has("ams.write") && <Card title="Editar"><ArticleForm a={a} /></Card>}
      </div>
    </>
  );
}
