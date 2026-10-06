import Link from "next/link";
export default function Forbidden() {
  return (
    <div role="alert" className="mx-auto mt-16 max-w-lg rounded-lg border border-amber-200 bg-white p-6 text-center">
      <h1 className="text-lg font-semibold">Acesso não permitido</h1>
      <p className="mt-2 text-sm text-slate-600">Seu perfil não tem permissão para esta área ou o módulo não está habilitado no plano. Solicite acesso ao administrador.</p>
      <Link href="/app" className="mt-4 inline-block text-sm text-brand-700 underline">Voltar ao painel</Link>
    </div>
  );
}
