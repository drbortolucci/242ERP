"use client";
import { ActionForm, Checkbox, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import type { ActionState } from "@/server/action";

type Opt = { value: string; label: string };
export interface ProfLookups { companies: Opt[]; teamRoles: Opt[]; seniorities: Opt[]; calendars: Opt[]; costCenters: Opt[]; businessUnits: Opt[]; skills: Opt[]; suppliers: Opt[]; professionals: Opt[] }

export function ProfessionalForm({ action, lk, p, skillIds = [] }: { action: (s: ActionState | undefined, fd: FormData) => Promise<ActionState>; lk: ProfLookups; p?: Record<string, unknown>; skillIds?: string[] }) {
  const v = (k: string) => (p?.[k] === null || p?.[k] === undefined ? "" : String(p[k]));
  return (
    <ActionForm action={action}>
      {p?.id ? <input type="hidden" name="id" value={String(p.id)} /> : null}
      <FormGrid cols={3}>
        <Input name="name" label="Nome" required defaultValue={v("name")} />
        <Input name="email" type="email" label="E-mail" defaultValue={v("email")} hint="Vincula automaticamente o usuário com o mesmo e-mail." />
        <Select name="companyId" label="Empresa" required options={lk.companies} placeholder="Selecione" defaultValue={v("companyId")} />
        <Select name="employmentType" label="Vínculo" options={[{ value: "CLT", label: "CLT" }, { value: "PJ", label: "PJ" }, { value: "PARTNER", label: "Parceiro" }, { value: "OTHER", label: "Outro" }]} defaultValue={v("employmentType") || "CLT"} />
        <Select name="supplierPartyId" label="Fornecedor que fatura (PJ/parceiro)" options={lk.suppliers} placeholder="—" defaultValue={v("supplierPartyId")} />
        <Select name="teamRoleId" label="Papel" options={lk.teamRoles} placeholder="—" defaultValue={v("teamRoleId")} />
        <Select name="seniorityId" label="Senioridade" options={lk.seniorities} placeholder="—" defaultValue={v("seniorityId")} />
        <Select name="managerId" label="Gestor" options={lk.professionals} placeholder="—" defaultValue={v("managerId")} />
        <Select name="calendarId" label="Calendário" options={lk.calendars} placeholder="Padrão" defaultValue={v("calendarId")} />
        <Select name="costCenterId" label="Centro de custo" options={lk.costCenters} placeholder="—" defaultValue={v("costCenterId")} />
        <Select name="businessUnitId" label="Unidade de negócio" options={lk.businessUnits} placeholder="—" defaultValue={v("businessUnitId")} />
        <Input name="capacityPct" label="Capacidade (% do calendário)" defaultValue={v("capacityPct") || "100"} />
        <Input name="certifications" label="Certificações (separadas por vírgula)" defaultValue={Array.isArray(p?.certifications) ? (p!.certifications as string[]).join(", ") : ""} />
      </FormGrid>
      <fieldset><legend className="mb-1 text-xs font-medium">Competências</legend>
        <div className="grid grid-cols-2 gap-1 md:grid-cols-4">{lk.skills.map((s) => <Checkbox key={s.value} name="skillIds[]" value={s.value} label={s.label} defaultChecked={skillIds.includes(s.value)} />)}</div>
      </fieldset>
      <SubmitButton>{p?.id ? "Salvar" : "Cadastrar profissional"}</SubmitButton>
    </ActionForm>
  );
}
