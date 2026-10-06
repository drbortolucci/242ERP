import Link from "next/link";
import type { ReactNode } from "react";
import { visibleNav } from "./nav";
import type { Ctx } from "@/server/context";
import { Bell, Search, Star } from "lucide-react";

export function AppShell({ ctx, children, orgs, unread, favorites }: { ctx: Ctx; children: ReactNode; orgs: { id: string; name: string }[]; unread: number; favorites: { label: string; href: string }[] }) {
  const nav = visibleNav(ctx.permissions, ctx.planModules);
  return (
    <div className="min-h-screen lg:flex">
      <aside className="no-print border-b border-slate-800 bg-slate-900 text-slate-200 lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:overflow-y-auto lg:border-b-0">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/app" className="text-lg font-bold text-white">242<span className="text-brand-500">ERP</span></Link>
        </div>
        <details className="lg:hidden px-4 pb-3"><summary className="cursor-pointer text-sm">Menu</summary><NavList nav={nav} /></details>
        <div className="hidden lg:block"><NavList nav={nav} /></div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
          <form action="/app/busca" method="get" role="search" className="flex flex-1 items-center gap-2">
            <Search className="h-4 w-4 text-slate-400" aria-hidden />
            <label htmlFor="global-q" className="sr-only">Busca global</label>
            <input id="global-q" name="q" placeholder="Buscar clientes, projetos, contratos, chamados…" className="w-full max-w-md rounded-md border border-slate-200 px-2 py-1 text-sm" />
          </form>
          {favorites.length > 0 && (
            <details className="relative text-sm">
              <summary className="flex cursor-pointer items-center gap-1 text-slate-600"><Star className="h-4 w-4" aria-hidden />Favoritos</summary>
              <ul className="absolute right-0 z-20 mt-1 w-56 rounded-md border bg-white p-1 shadow">
                {favorites.map((f) => <li key={f.href}><Link className="block rounded px-2 py-1 hover:bg-slate-100" href={f.href}>{f.label}</Link></li>)}
              </ul>
            </details>
          )}
          <Link href="/app/notificacoes" className="relative text-slate-600" aria-label={`Notificações (${unread} não lidas)`}>
            <Bell className="h-5 w-5" />
            {unread > 0 && <span className="absolute -right-2 -top-1 rounded-full bg-red-600 px-1 text-[10px] text-white">{unread}</span>}
          </Link>
          {orgs.length > 1 ? (
            <form action="/api/auth/switch-org" method="post" className="text-sm">
              <label htmlFor="org-switch" className="sr-only">Organização</label>
              <select id="org-switch" name="orgId" defaultValue={ctx.orgId} className="rounded border border-slate-200 px-1 py-1 text-sm">
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <button className="ml-1 text-xs text-brand-700" type="submit">Trocar</button>
            </form>
          ) : <span className="text-sm font-medium text-slate-700">{ctx.orgName}</span>}
          <details className="relative text-sm">
            <summary className="cursor-pointer text-slate-700">{ctx.userName}</summary>
            <ul className="absolute right-0 z-20 mt-1 w-48 rounded-md border bg-white p-1 shadow">
              <li><Link className="block rounded px-2 py-1 hover:bg-slate-100" href="/app/perfil">Meu perfil e segurança</Link></li>
              <li><form action="/api/auth/logout" method="post"><button className="w-full rounded px-2 py-1 text-left hover:bg-slate-100">Sair</button></form></li>
            </ul>
          </details>
        </header>
        {ctx.support && <div className="bg-violet-700 px-4 py-1 text-sm text-white">Sessão de SUPORTE (somente leitura, temporária e auditada)</div>}
        {!ctx.support && ctx.orgStatus === "PAST_DUE" && <div className="bg-amber-500 px-4 py-1 text-sm text-white">Assinatura com pagamento pendente. Regularize em Administração › Assinatura para evitar suspensão.</div>}
        {!ctx.support && (ctx.orgStatus === "SUSPENDED" || ctx.orgStatus === "CANCELED") && <div className="bg-red-700 px-4 py-1 text-sm text-white">Organização {ctx.orgStatus === "SUSPENDED" ? "suspensa" : "cancelada"}: dados preservados em modo somente leitura.</div>}
        <main className="mx-auto max-w-[1400px] p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

function NavList({ nav }: { nav: ReturnType<typeof visibleNav> }) {
  return (
    <nav aria-label="Módulos" className="space-y-4 px-2 pb-6">
      {nav.map((g) => (
        <div key={g.label}>
          <div className="px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</div>
          <ul className="mt-1 space-y-0.5">
            {g.items.map((i) => (
              <li key={i.href}><Link href={i.href} className="block rounded px-2 py-1 text-sm text-slate-200 hover:bg-slate-800 hover:text-white">{i.label}</Link></li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
