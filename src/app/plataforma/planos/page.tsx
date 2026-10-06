import { PageHeader, Card } from "@/components/ui/page";
import { ActionForm, Checkbox, FormGrid, Input, SubmitButton } from "@/components/ui/form";
import { requirePlatformAdmin } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { ALL_MODULES } from "@/modules/saas/plans";
import { updatePlanAction } from "../actions";

export default async function PlansPage() {
  await requirePlatformAdmin();
  const plans = await prisma.plan.findMany({ orderBy: { rank: "asc" } });
  return (
    <>
      <PageHeader title="Planos" subtitle="Módulos e limites aplicados no servidor. Alterações são auditadas." />
      <div className="space-y-4">
        {plans.map((p) => (
          <Card key={p.id} title={`${p.name} (${p.code})`}>
            <ActionForm action={updatePlanAction}>
              <input type="hidden" name="id" value={p.id} />
              <FormGrid cols={3}>
                <Input name="name" label="Nome" defaultValue={p.name} /><Input name="priceMonthly" label="Preço mensal" defaultValue={p.priceMonthly.toFixed(2)} /><Input name="trialDays" type="number" label="Dias de avaliação" defaultValue={String(p.trialDays)} />
                <Input name="maxUsers" type="number" label="Usuários" defaultValue={String(p.maxUsers)} /><Input name="maxCompanies" type="number" label="Empresas" defaultValue={String(p.maxCompanies)} /><Input name="maxStorageMb" type="number" label="Armazenamento (MB)" defaultValue={String(p.maxStorageMb)} />
              </FormGrid>
              <div className="grid gap-1 md:grid-cols-6">{ALL_MODULES.map((m) => <Checkbox key={m} name="modules[]" value={m} label={m} defaultChecked={p.modules.includes(m)} />)}</div>
              <Checkbox name="active" label="Ativo" defaultChecked={p.active} />
              <SubmitButton>Salvar plano</SubmitButton>
            </ActionForm>
          </Card>
        ))}
      </div>
    </>
  );
}
