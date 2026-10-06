import Link from "next/link";
import { ActionForm, Input, SubmitButton } from "@/components/ui/form";
import { forgotAction } from "../actions";

export const metadata = { title: "Recuperar acesso" };
export default function ForgotPage() {
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold">Recuperar acesso</h1>
      <ActionForm action={forgotAction}>
        <Input label="E-mail" name="email" type="email" required />
        <SubmitButton className="w-full">Enviar link</SubmitButton>
      </ActionForm>
      <p className="mt-3 text-xs text-slate-500">Em ambiente de desenvolvimento os e-mails são simulados e ficam na caixa de saída (sem envio real).</p>
      <p className="mt-3 text-center text-sm"><Link className="text-brand-700 hover:underline" href="/login">Voltar</Link></p>
    </>
  );
}
