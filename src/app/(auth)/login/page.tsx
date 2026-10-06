import Link from "next/link";
import { ActionForm, Input, SubmitButton } from "@/components/ui/form";
import { loginAction } from "../actions";

export const metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold">Entrar</h1>
      {sp.reset && <p role="status" className="mb-3 rounded bg-emerald-50 p-2 text-sm text-emerald-800">Senha redefinida. Entre com a nova senha.</p>}
      <ActionForm action={loginAction}>
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <Input label="E-mail" name="email" type="email" autoComplete="email" required />
        <Input label="Senha" name="password" type="password" autoComplete="current-password" required />
        <SubmitButton className="w-full">Entrar</SubmitButton>
      </ActionForm>
      <div className="mt-4 flex justify-between text-sm">
        <Link className="text-brand-700 hover:underline" href="/esqueci-senha">Esqueci minha senha</Link>
        <Link className="text-brand-700 hover:underline" href="/cadastro">Criar organização</Link>
      </div>
    </>
  );
}
