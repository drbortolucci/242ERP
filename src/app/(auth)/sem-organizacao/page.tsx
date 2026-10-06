import Link from "next/link";
export default function NoOrg() {
  return (
    <div className="space-y-3 text-sm">
      <h1 className="text-lg font-semibold">Nenhuma organização ativa</h1>
      <p>Seu usuário não participa de nenhuma organização ativa. Solicite um convite ao administrador ou crie uma nova organização.</p>
      <form action="/api/auth/logout" method="post"><button className="text-brand-700 underline">Sair</button></form>
      <Link className="text-brand-700 underline" href="/cadastro">Criar organização</Link>
    </div>
  );
}
