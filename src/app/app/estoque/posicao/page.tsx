import { PageHeader, Stat, Grid, Badge } from "@/components/ui/page";
import { DataTable, Toolbar, TotalRow } from "@/components/ui/table";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { stockPosition } from "@/modules/inventory/service";
import { sp, type SearchParams } from "@/lib/query";
import { formatMoney, formatQty } from "@/lib/money";
import { warehouseOptions } from "../lookups";

export const metadata = { title: "Posição de estoque" };
export default async function StockPositionPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pagePerm(ctx, "inventory.read");
  const warehouseId = sp(s, "deposito");
  const belowMin = sp(s, "abaixo") === "1";
  const [{ rows, totalValue }, whs] = await Promise.all([stockPosition(ctx, { warehouseId, q: sp(s, "q"), belowMin }), warehouseOptions(ctx)]);
  const showCost = ctx.permissions.has("cost.view") || ctx.permissions.has("inventory.adjust");
  return (
    <>
      <PageHeader title="Posição de estoque" subtitle="Saldo, reservas e valor ao custo médio móvel" breadcrumbs={[{ label: "Estoque" }, { label: "Posição" }]} />
      <Grid cols={3}>
        <Stat label="Itens" value={rows.length} />
        <Stat label="Abaixo do mínimo" value={rows.filter((r) => r.belowMin).length} href="/app/estoque/posicao?abaixo=1" tone={rows.some((r) => r.belowMin) ? "warn" : "default"} />
        {showCost && <Stat label="Valor total em estoque" value={formatMoney(totalValue)} />}
      </Grid>
      <div className="mt-6">
        <Toolbar base="/app/estoque/posicao" params={s} filters={[{ name: "deposito", label: "Depósito", options: whs }, { name: "abaixo", label: "Situação", options: [{ value: "1", label: "Abaixo do mínimo" }] }]} />
        <DataTable rows={rows.map((r) => ({ ...r, id: r.product.id }))} rowHref={(r) => `/app/estoque/produtos/${r.product.id}`} empty="Nenhum produto com controle de estoque." columns={[
          { key: "c", label: "Código", render: (r) => r.product.code }, { key: "n", label: "Produto", render: (r) => r.product.name }, { key: "u", label: "Unid.", render: (r) => r.product.unit },
          { key: "q", label: "Saldo", align: "right", render: (r) => formatQty(r.quantity, 2) }, { key: "r", label: "Reservado", align: "right", render: (r) => formatQty(r.reserved, 2) },
          { key: "a", label: "Disponível", align: "right", render: (r) => formatQty(r.available, 2) }, { key: "m", label: "Mínimo", align: "right", render: (r) => formatQty(r.product.minStock, 2) },
          ...(showCost ? [{ key: "cm", label: "Custo médio", align: "right" as const, render: (r: (typeof rows)[number]) => formatMoney(r.avgCost) }, { key: "v", label: "Valor", align: "right" as const, render: (r: (typeof rows)[number]) => formatMoney(r.value) }] : []),
          { key: "b", label: "", render: (r) => (r.belowMin ? <Badge tone="amber">repor</Badge> : null) },
        ]} footer={showCost ? <TotalRow cells={["Total", "", "", "", "", "", "", "", formatMoney(totalValue), ""]} /> : undefined} />
      </div>
    </>
  );
}
