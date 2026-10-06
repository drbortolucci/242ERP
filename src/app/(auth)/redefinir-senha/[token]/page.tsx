import { ActionForm, Input, SubmitButton } from "@/components/ui/form";
import { resetAction } from "../../actions";

export const metadata = { title: "Redefinir senha" };
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold">Definir nova senha</h1>
      <ActionForm action={resetAction}>
        <input type="hidden" name="token" value={token} />
        <Input label="Nova senha" name="password" type="password" required autoComplete="new-password" />
        <Input label="Confirmar senha" name="confirm" type="password" required autoComplete="new-password" />
        <SubmitButton className="w-full">Salvar</SubmitButton>
      </ActionForm>
    </>
  );
}
