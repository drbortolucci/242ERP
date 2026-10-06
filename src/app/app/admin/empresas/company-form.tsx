"use client";
import { ActionForm, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import type { ActionState } from "@/server/action";

type Company = Record<string, unknown> & { address?: Record<string, string> };
const REGIMES = ["Simples Nacional", "Lucro Presumido", "Lucro Real", "MEI", "Outro"].map((r) => ({ value: r, label: r }));

export function CompanyForm({ action, company, parents, hidden, submitLabel = "Salvar", allowBranch = true }: {
  action: (p: ActionState | undefined, fd: FormData) => Promise<ActionState>; company?: Company; parents?: { value: string; label: string }[]; hidden?: Record<string, string>; submitLabel?: string; allowBranch?: boolean;
}) {
  const a = company?.address ?? {};
  const v = (k: string) => String(company?.[k] ?? "");
  return (
    <ActionForm action={action}>
      {Object.entries(hidden ?? {}).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
      <FormGrid cols={3}>
        {allowBranch && <Select name="kind" label="Tipo" options={[{ value: "HEADQUARTERS", label: "Matriz / empresa independente" }, { value: "BRANCH", label: "Filial" }]} defaultValue={v("kind") || "HEADQUARTERS"} />}
        {allowBranch && <Select name="parentId" label="Matriz (para filial)" options={parents ?? []} placeholder="—" defaultValue={v("parentId")} />}
        <Input name="legalName" label="Razão social" required defaultValue={v("legalName")} />
        <Input name="tradeName" label="Nome fantasia" defaultValue={v("tradeName")} />
        <Input name="cnpj" label="CNPJ" required defaultValue={v("cnpj")} hint="Validamos formato e dígitos verificadores. A abertura legal do CNPJ é externa ao ERP." />
        <Input name="stateRegistration" label="Inscrição estadual" defaultValue={v("stateRegistration")} />
        <Input name="municipalRegistration" label="Inscrição municipal" defaultValue={v("municipalRegistration")} />
        <Select name="taxRegime" label="Regime tributário (informado)" options={REGIMES} placeholder="—" defaultValue={v("taxRegime")} />
        <Input name="email" type="email" label="E-mail" defaultValue={v("email")} />
        <Input name="phone" label="Telefone" defaultValue={v("phone")} />
        <Input name="street" label="Logradouro" defaultValue={a.street ?? ""} />
        <Input name="number" label="Número" defaultValue={a.number ?? ""} />
        <Input name="district" label="Bairro" defaultValue={a.district ?? ""} />
        <Input name="city" label="Cidade" defaultValue={a.city ?? ""} />
        <Input name="state" label="UF" maxLength={2} defaultValue={a.state ?? ""} />
        <Input name="zip" label="CEP" defaultValue={a.zip ?? ""} />
        <Input name="municipalityCode" label="Código IBGE do município" defaultValue={v("municipalityCode")} />
        <Select name="currency" label="Moeda" options={[{ value: "BRL", label: "Real (BRL)" }, { value: "USD", label: "Dólar (USD)" }, { value: "EUR", label: "Euro (EUR)" }]} defaultValue={v("currency") || "BRL"} />
        <Select name="timezone" label="Fuso horário" options={["America/Sao_Paulo", "America/Manaus", "America/Belem", "America/Fortaleza", "America/Recife", "America/Cuiaba", "America/Porto_Velho", "America/Rio_Branco", "America/Noronha", "UTC"].map((t) => ({ value: t, label: t }))} defaultValue={v("timezone") || "America/Sao_Paulo"} />
        <Input name="responsibleName" label="Responsável" defaultValue={v("responsibleName")} />
        <Input name="responsibleEmail" type="email" label="E-mail do responsável" defaultValue={v("responsibleEmail")} />
      </FormGrid>
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
