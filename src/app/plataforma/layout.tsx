import Link from "next/link";
import { requirePlatformAdmin } from "@/server/auth/next";

export const dynamic = "force-dynamic";
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePlatformAdmin();
  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-4 bg-slate-900 px-4 py-3 text-sm text-slate-200">
        <b className="text-white">242ERP · Plataforma</b>
        <Link href="/plataforma">Métricas</Link><Link href="/plataforma/organizacoes">Organizações</Link><Link href="/plataforma/planos">Planos</Link>
        <span className="ml-auto">{u.name}</span>
        <form action="/api/auth/logout" method="post"><button className="underline">Sair</button></form>
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  );
}
