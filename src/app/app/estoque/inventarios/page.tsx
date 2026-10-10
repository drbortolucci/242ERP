import { PageHeader, Card, StatusBadge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionForm, Checkbox, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { formatCivil, todayIn } from "@/lib/dates";
import { openCountAction } from "../actions";
import { warehouseOptions } from "../lookups";

export const metadata = { title: "Inventários" };
export default async function CountsPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "inventory.read");
  const [rows, whs] = await Promise.all([ctx.db.inventoryCount.findMany({ orderBy: { createdAt: "desc" }, take: 100 }), warehouseOptions(ctx)]);
  const wh = new Map(whs.map((w) => [w.value, w.label]));
  return (
    <>
      <PageHeader title="Inventários (contagem física)" subtitle="As diferenças entre o contado e o saldo viram ajustes ao custo médio no encerramento" breadcrumbs={[{ label: "Estoque" }, { label: "Inventários" }]} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <DataTable rows={rows} rowHref={(r) => `/app/estoque/inventarios/${r.id}`} empty="Nenhum inventário." columns={[
            { key: "number", label: "Número" }, { key: "w", label: "Depósito", render: (r) => wh.get(r.warehouseId) ?? "—" }, { key: "d", label: "Data", render: (r) => formatCivil(r.date) },
            { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> },
          ]} />
        </div>
        {ctx.permissions.has("inventory.adjust") && (
          <Card title="Abrir inventário">
            <ActionForm action={openCountAction}>
              <Select name="warehouseId" label="Depósito" options={whs} required />
              <Input name="date" type="date" label="Data da contagem" defaultValue={todayIn(ctx.timezone)} required />
              <Checkbox name="onlyWithBalance" label="Somente itens com saldo" />
              <Textarea name="notes" label="Observações" />
              <SubmitButton>Abrir</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
