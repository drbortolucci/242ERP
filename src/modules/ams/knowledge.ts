/** Base de conhecimento: artigos internos ou visíveis ao cliente, busca e sugestão a partir do chamado. */
import { z } from "zod";
import { requirePerm, type Ctx, requireWritable } from "@/server/context";
import { audit } from "@/server/audit";
import { notFound } from "@/lib/errors";
import { zBool, zOptStr, zStr } from "@/lib/zod-helpers";

export const articleSchema = z.object({ title: zStr(3), body: zStr(10), tags: z.string().optional(), system: zOptStr, clientVisible: zBool, published: zBool });
const splitTags = (s?: string) => (s ?? "").split(/[,;]/).map((t) => t.trim().toLowerCase()).filter(Boolean);

export async function saveArticle(ctx: Ctx, id: string | null, i: z.infer<typeof articleSchema>) {
  requireWritable(ctx);
  requirePerm(ctx, "ams.write");
  const data = { title: i.title, body: i.body, tags: splitTags(i.tags), system: i.system ?? null, clientVisible: i.clientVisible, published: i.published };
  if (id) {
    if (!(await ctx.db.knowledgeArticle.findFirst({ where: { id } }))) throw notFound("Artigo");
    const a = await ctx.db.knowledgeArticle.update({ where: { id }, data });
    await audit(ctx, { action: "kb.update", entity: "KnowledgeArticle", entityId: id });
    return a;
  }
  const a = await ctx.db.knowledgeArticle.create({ data: { organizationId: ctx.orgId, ...data, createdById: ctx.userId } });
  await audit(ctx, { action: "kb.create", entity: "KnowledgeArticle", entityId: a.id });
  return a;
}

/** Busca por termos no título/corpo/etiquetas; cliente só vê artigos publicados e visíveis ao cliente. */
export async function searchArticles(ctx: Ctx, q: string, opts: { system?: string | null; take?: number } = {}) {
  if (ctx.kind === "CLIENT") requirePerm(ctx, "portal.access");
  else requirePerm(ctx, "ams.read");
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length >= 3).slice(0, 6);
  const clientOnly = ctx.kind === "CLIENT" ? { clientVisible: true, published: true } : {};
  const rows = await ctx.db.knowledgeArticle.findMany({
    where: { ...clientOnly, ...(words.length ? { OR: words.flatMap((w) => [{ title: { contains: w, mode: "insensitive" as const } }, { body: { contains: w, mode: "insensitive" as const } }, { tags: { has: w } }]) } : {}) },
    orderBy: { updatedAt: "desc" }, take: 50,
  });
  // relevância: termos no título valem mais; mesmo sistema soma
  const score = (a: (typeof rows)[number]) => words.reduce((s, w) => s + (a.title.toLowerCase().includes(w) ? 3 : 0) + (a.tags.includes(w) ? 2 : 0) + (a.body.toLowerCase().includes(w) ? 1 : 0), 0) + (opts.system && a.system === opts.system ? 2 : 0);
  return rows.map((a) => ({ a, s: score(a) })).filter((x) => !words.length || x.s > 0).sort((x, y) => y.s - x.s).slice(0, opts.take ?? 20).map((x) => x.a);
}
