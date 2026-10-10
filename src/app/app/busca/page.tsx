import Link from "@/components/ui/access-link";
import { PageHeader, Card, EmptyState } from "@/components/ui/page";
import { requireCtx } from "@/server/auth/next";
import { can } from "@/server/context";

export const metadata = { title: "Busca" };
type Hit = { href: string; title: string; sub?: string };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireCtx();
  const q = ((await searchParams).q ?? "").trim();
  const groups: { label: string; hits: Hit[] }[] = [];
  if (q.length >= 2) {
    const c = { contains: q, mode: "insensitive" as const };
    const take = 8;
    if (can(ctx, "master.read")) {
      const ps = await ctx.db.party.findMany({ where: { OR: [{ name: c }, { tradeName: c }, { document: { contains: q.replace(/\D/g, "") || q } }] }, take });
      groups.push({ label: "Clientes, fornecedores e parceiros", hits: ps.map((p) => ({ href: `/app/cadastros/${p.isCustomer || p.isProspect ? "clientes" : p.isSupplier ? "fornecedores" : "parceiros"}/${p.id}`, title: p.tradeName || p.name, sub: [p.isCustomer && "cliente", p.isSupplier && "fornecedor", p.isPartner && "parceiro"].filter(Boolean).join(", ") })) });
    }
    if (can(ctx, "crm.read")) {
      const os = await ctx.db.opportunity.findMany({ where: { OR: [{ title: c }, { number: c }] }, take });
      groups.push({ label: "Oportunidades", hits: os.map((o) => ({ href: `/app/crm/oportunidades/${o.id}`, title: `${o.number} — ${o.title}` })) });
      const pr = await ctx.db.proposal.findMany({ where: { OR: [{ title: c }, { number: c }] }, take });
      groups.push({ label: "Propostas", hits: pr.map((o) => ({ href: `/app/propostas/${o.id}`, title: `${o.number} — ${o.title}` })) });
    }
    if (can(ctx, "contract.read")) {
      const cs = await ctx.db.contract.findMany({ where: { OR: [{ title: c }, { number: c }] }, take });
      groups.push({ label: "Contratos", hits: cs.map((o) => ({ href: `/app/contratos/${o.id}`, title: `${o.number} — ${o.title}` })) });
    }
    if (can(ctx, "project.read")) {
      const ps = await ctx.db.project.findMany({ where: { OR: [{ name: c }, { code: c }] }, take });
      groups.push({ label: "Projetos", hits: ps.map((o) => ({ href: `/app/projetos/${o.id}`, title: `${o.code} — ${o.name}` })) });
    }
    if (can(ctx, "ams.read")) {
      const ts = await ctx.db.ticket.findMany({ where: { OR: [{ title: c }, { number: c }] }, take });
      groups.push({ label: "Chamados", hits: ts.map((o) => ({ href: `/app/ams/chamados/${o.id}`, title: `${o.number} — ${o.title}` })) });
    }
    if (can(ctx, "resource.read") || can(ctx, "master.read")) {
      const ps = await ctx.db.professional.findMany({ where: { OR: [{ name: c }, { email: c }] }, take });
      groups.push({ label: "Profissionais", hits: ps.map((o) => ({ href: `/app/cadastros/profissionais/${o.id}`, title: o.name })) });
    }
    if (can(ctx, "purchase.write") || can(ctx, "finance.read")) {
      const pos = await ctx.db.purchaseOrder.findMany({ where: { number: c }, take });
      groups.push({ label: "Pedidos de compra", hits: pos.map((o) => ({ href: `/app/suprimentos/pedidos/${o.id}`, title: o.number })) });
    }
    if (can(ctx, "billing.read")) {
      const bd = await ctx.db.billingDocument.findMany({ where: { number: c }, take });
      groups.push({ label: "Documentos de cobrança", hits: bd.map((o) => ({ href: `/app/faturamento/cobrancas/${o.id}`, title: o.number })) });
    }
  }
  const total = groups.reduce((a, g) => a + g.hits.length, 0);
  return (
    <>
      <PageHeader title={`Busca: “${q}”`} subtitle="Resultados limitados às suas permissões e ao seu escopo de empresas." />
      {q.length < 2 ? <EmptyState title="Digite ao menos 2 caracteres" /> : total === 0 ? <EmptyState title="Nada encontrado" /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.filter((g) => g.hits.length).map((g) => (
            <Card key={g.label} title={g.label}><ul className="space-y-1 text-sm">{g.hits.map((h) => <li key={h.href}><Link className="text-brand-700 hover:underline" href={h.href}>{h.title}</Link>{h.sub && <span className="text-xs text-slate-500"> · {h.sub}</span>}</li>)}</ul></Card>
          ))}
        </div>
      )}
    </>
  );
}
