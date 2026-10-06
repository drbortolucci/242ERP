import { ActionForm, Input, SubmitButton } from "@/components/ui/form";
import { mfaAction } from "../actions";

export const metadata = { title: "Verificação em duas etapas" };
export default function MfaPage() {
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold">Verificação em duas etapas</h1>
      <ActionForm action={mfaAction}>
        <Input label="Código do aplicativo autenticador" name="code" inputMode="numeric" autoComplete="one-time-code" required />
        <SubmitButton className="w-full">Verificar</SubmitButton>
      </ActionForm>
    </>
  );
}
