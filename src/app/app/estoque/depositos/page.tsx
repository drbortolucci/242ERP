import { PageHeader, Card, Badge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionForm, Checkbox, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { lookups } from "@/modules/config/lookups";
import { formatMoney, sum } from "@/lib/money";
import { saveWarehouseAction } from "../actions";

export const metadata = { title: "Depósitos" };
export default async function WarehousesPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "inventory.read");
  const [rows, companies, balances] = await Promise.all([ctx.db.warehouse.findMany({ orderBy: { code: "asc" } }), lookups.companies(ctx), ctx.db.stockBalance.findMany()]);
  const company = new Map(companies.map((c) => [c.value, c.label]));
  const canWrite = ctx.permissions.has("inventory.write");
  const showCost = ctx.permissions.has("cost.view") || ctx.permissions.has("inventory.adjust");
  return (
    <>
      <PageHeader title="Depósitos" subtitle="Locais de estoque por empresa (almoxarifado, loja, filial, veículo de campo…)" breadcrumbs={[{ label: "Estoque" }, { label: "Depósitos" }]} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <DataTable rows={rows} empty="Nenhum depósito cadastrado." columns={[
            { key: "code", label: "Código" }, { key: "name", label: "Nome" }, { key: "c", label: "Empresa", render: (w) => company.get(w.companyId) ?? "—" },
            ...(showCost ? [{ key: "v", label: "Valor em estoque", align: "right" as const, render: (w: (typeof rows)[number]) => formatMoney(sum(balances.filter((b) => b.warehouseId === w.id).map((b) => b.value))) }] : []),
            { key: "f", label: "", render: (w) => <>{w.allowNegative && <Badge tone="amber">aceita saldo negativo</Badge>} {!w.active && <Badge>inativo</Badge>}</> },
          ]} />
          {canWrite && rows.map((w) => (
            <details key={w.id} className="rounded border bg-white p-2 text-sm">
              <summary className="cursor-pointer">Editar {w.code}</summary>
              <ActionForm action={saveWarehouseAction} className="mt-2">
                <input type="hidden" name="id" value={w.id} />
                <FormGrid cols={3}><Select name="companyId" label="Empresa" options={companies} defaultValue={w.companyId} required /><Input name="code" label="Código" defaultValue={w.code} required /><Input name="name" label="Nome" defaultValue={w.name} required /></FormGrid>
                <div className="flex gap-6"><Checkbox name="allowNegative" label="Aceita saldo negativo" defaultChecked={w.allowNegative} /><Checkbox name="active" label="Ativo" defaultChecked={w.active} /></div>
                <SubmitButton variant="secondary">Salvar</SubmitButton>
              </ActionForm>
            </details>
          ))}
        </div>
        {canWrite && (
          <Card title="Novo depósito">
            <ActionForm action={saveWarehouseAction} resetOnSuccess>
              <Select name="companyId" label="Empresa" options={companies} required />
              <FormGrid cols={2}><Input name="code" label="Código" required maxLength={20} /><Input name="name" label="Nome" required /></FormGrid>
              <Checkbox name="allowNegative" label="Aceita saldo negativo (não recomendado)" />
              <input type="hidden" name="active" value="on" />
              <SubmitButton>Criar depósito</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
