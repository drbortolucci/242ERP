import { ActionForm, Input, SubmitButton } from "@/components/ui/form";
import { acceptInviteAction } from "../../actions";
import { getInvitation } from "@/modules/auth/service";
import { getSession } from "@/server/auth/next";
import { prisma } from "@/server/db";

export const metadata = { title: "Aceitar convite" };
export const dynamic = "force-dynamic";
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await getInvitation(token);
  if (!found) return <p className="text-sm text-red-700">Convite inválido, expirado ou já utilizado. Solicite um novo convite ao administrador.</p>;
  const session = await getSession();
  const existing = await prisma.user.findUnique({ where: { email: found.inv.email } });
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Convite para {found.org?.name}</h1>
      <p className="mb-4 text-sm text-slate-600">E-mail convidado: <b>{found.inv.email}</b></p>
      {existing && session?.userId !== existing.id ? (
        <p className="text-sm">Este e-mail já possui conta. <a className="text-brand-700 underline" href={`/login?next=/convite/${token}`}>Entre</a> para aceitar o convite.</p>
      ) : (
        <ActionForm action={acceptInviteAction}>
          <input type="hidden" name="token" value={token} />
          {!existing && <><Input label="Seu nome" name="name" required /><Input label="Senha" name="password" type="password" required autoComplete="new-password" hint="Mínimo de 10 caracteres, com letras e números." /></>}
          <SubmitButton className="w-full">Aceitar convite</SubmitButton>
        </ActionForm>
      )}
    </>
  );
}
