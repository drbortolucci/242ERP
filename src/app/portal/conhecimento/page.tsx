import { PageHeader, Card } from "@/components/ui/page";
import { requireCtx } from "@/server/auth/next";
import { portalScope } from "@/modules/portal/service";
import { searchArticles } from "@/modules/ams/knowledge";
import { sp, type SearchParams } from "@/lib/query";

export const metadata = { title: "Base de conhecimento" };
export default async function PortalKnowledge({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  portalScope(ctx);
  const q = sp(s, "q") ?? "";
  const rows = await searchArticles(ctx, q, { take: 30 }); // apenas publicados e visíveis ao cliente
  return (
    <>
      <PageHeader title="Base de conhecimento" />
      <form method="get" className="mb-4 flex gap-2"><label htmlFor="kq" className="sr-only">Buscar</label><input id="kq" name="q" defaultValue={q} placeholder="Buscar artigos" className="w-full max-w-md rounded border px-2 py-1 text-sm" /><button className="rounded bg-slate-800 px-3 text-sm text-white">Buscar</button></form>
      <div className="space-y-4">{rows.map((a) => <Card key={a.id} title={a.title}><div className="whitespace-pre-wrap text-sm">{a.body}</div></Card>)}{rows.length === 0 && <p className="text-sm text-slate-500">Nenhum artigo encontrado.</p>}</div>
    </>
  );
}
