import { PageHeader, Card, Notice } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionForm, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import { pagePerm } from "@/server/page-guard";
import { requireCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { lookups, nameMap } from "@/modules/config/lookups";
import { formatCivil, todayIn } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { createPriceTableAction, addPriceItemAction } from "../special-actions";

export default async function PriceTablesPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "settings.manage");
  const [tables, items, roles, sens, services] = await Promise.all([ctx.db.priceTable.findMany({ orderBy: { validFrom: "desc" } }), ctx.db.priceTableItem.findMany(), lookups.teamRoles(ctx), lookups.seniorities(ctx), lookups.services(ctx)]);
  const [rn, sn, svn] = await Promise.all([nameMap(ctx, "teamRole", items.map((i) => i.teamRoleId)), nameMap(ctx, "seniorityLevel", items.map((i) => i.seniorityId)), nameMap(ctx, "service", items.map((i) => i.serviceId))]);
  const showCost = can(ctx, "cost.view");
  return (
    <>
      <PageHeader title="Tabelas de preços e custos de referência" subtitle="Tarifas com vigência. Propostas e contratos gravam um snapshot das tarifas — alterações futuras não modificam documentos emitidos." breadcrumbs={[{ label: "Configurador", href: "/app/config" }, { label: "Tabelas de preço" }]} />
      {!can(ctx, "cost.manage") && <div className="mb-4"><Notice tone="info">Alterar tarifas exige a permissão “Alterar custos/hora e tarifas”.</Notice></div>}
      <div className="space-y-6">
        {tables.map((t) => (
          <Card key={t.id} title={`${t.name} — vigência ${formatCivil(t.validFrom)} a ${formatCivil(t.validTo)}`}>
            <DataTable dense rows={items.filter((i) => i.priceTableId === t.id)} columns={[
              { key: "role", label: "Papel", render: (i) => rn.get(i.teamRoleId ?? "") ?? "—" }, { key: "sen", label: "Senioridade", render: (i) => sn.get(i.seniorityId ?? "") ?? "—" }, { key: "svc", label: "Serviço", render: (i) => svn.get(i.serviceId ?? "") ?? "—" },
              { key: "hourlyRate", label: "Tarifa/hora", align: "right", render: (i) => formatMoney(i.hourlyRate) },
              ...(showCost ? [{ key: "referenceCost", label: "Custo ref./hora", align: "right" as const, render: (i: (typeof items)[number]) => (i.referenceCost ? formatMoney(i.referenceCost) : "—") }] : []),
            ]} empty={<p className="text-sm text-slate-500">Sem tarifas.</p>} />
            {can(ctx, "cost.manage") && (
              <ActionForm action={addPriceItemAction} resetOnSuccess className="mt-3">
                <input type="hidden" name="priceTableId" value={t.id} />
                <FormGrid cols={4}>
                  <Select name="teamRoleId" label="Papel" options={roles} placeholder="—" /><Select name="seniorityId" label="Senioridade" options={sens} placeholder="—" /><Select name="serviceId" label="Serviço" options={services} placeholder="—" />
                  <Input name="hourlyRate" label="Tarifa/hora" required /><Input name="referenceCost" label="Custo de referência/hora" />
                </FormGrid>
                <SubmitButton variant="secondary">Salvar tarifa</SubmitButton>
              </ActionForm>
            )}
          </Card>
        ))}
        {can(ctx, "cost.manage") && (
          <Card title="Nova tabela (nova vigência)">
            <ActionForm action={createPriceTableAction}>
              <FormGrid cols={4}><Input name="name" label="Nome" required /><Input name="validFrom" type="date" label="Vigente de" defaultValue={todayIn(ctx.timezone)} required /><Input name="validTo" type="date" label="Até (opcional)" /><Select name="copyFromId" label="Copiar tarifas de" options={tables.map((t) => ({ value: t.id, label: t.name }))} placeholder="—" /></FormGrid>
              <SubmitButton>Criar tabela</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
