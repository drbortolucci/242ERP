import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/next";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";
const NAV = [["/portal", "Início"], ["/portal/chamados", "Chamados"], ["/portal/aprovacoes", "Aprovações"], ["/portal/projetos", "Projetos"], ["/portal/financeiro", "Financeiro"], ["/portal/conhecimento", "Base de conhecimento"]];

/** Portal do cliente: navegação própria, sem acesso às telas internas. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  if (ctx.kind !== "CLIENT") redirect("/app");
  const party = ctx.partyId ? await prisma.party.findFirst({ where: { id: ctx.partyId, organizationId: ctx.orgId }, select: { name: true, tradeName: true } }) : null;
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="font-bold">{ctx.orgName} <span className="font-normal text-slate-500">· Portal do cliente</span></span>
          <nav aria-label="Portal" className="flex flex-wrap gap-3 text-sm">{NAV.filter(([h]) => h !== "/portal/aprovacoes" || ctx.permissions.has("portal.approve")).map(([h, l]) => <Link key={h} href={h} className="text-slate-700 hover:underline">{l}</Link>)}</nav>
          <span className="ml-auto text-sm text-slate-600">{ctx.userName} — {party?.tradeName || party?.name}</span>
          <form action="/api/auth/logout" method="post"><button className="text-sm text-slate-600 underline">Sair</button></form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{ctx.planModules.includes("portal") ? children : <p className="rounded border bg-white p-4 text-sm text-slate-700">O portal do cliente não está disponível no plano atual do fornecedor. Entre em contato com seu atendimento.</p>}</main>
    </div>
  );
}
