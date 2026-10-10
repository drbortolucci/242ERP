import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card, DefinitionList, Stat, Grid } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { lookups } from "@/modules/config/lookups";
import { formatCivil } from "@/lib/dates";
import { dec, formatMoney, formatQty, sum } from "@/lib/money";
import { MOVEMENT_LABEL } from "@/modules/inventory/stock";
import { ProductFields } from "../../product-form";
import { saveProductAction } from "../../actions";
import { productKindLabel } from "../../lookups";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  pagePerm(ctx, "inventory.read");
  const p = await ctx.db.product.findFirst({ where: { id } });
  if (!p) notFound();
  const [balances, movements, warehouses, categories, accounts] = await Promise.all([
    ctx.db.stockBalance.findMany({ where: { productId: id } }),
    ctx.db.stockMovement.findMany({ where: { productId: id }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 50 }),
    ctx.db.warehouse.findMany(), ctx.db.productCategory.findMany({ where: { active: true }, orderBy: { name: "asc" } }), lookups.accounts(ctx),
  ]);
  const wh = new Map(warehouses.map((w) => [w.id, w]));
  const qty = sum(balances.map((b) => b.quantity));
  const value = sum(balances.map((b) => b.value));
  const reserved = sum(balances.map((b) => b.reserved));
  const showCost = ctx.permissions.has("cost.view") || ctx.permissions.has("inventory.adjust");
  return (
    <>
      <PageHeader title={`${p.code} — ${p.name}`} subtitle={productKindLabel(p.kind)} breadcrumbs={[{ label: "Estoque" }, { label: "Produtos", href: "/app/estoque/produtos" }, { label: p.code }]} />
      {p.tracksStock && (
        <Grid cols={4}>
          <Stat label="Saldo total" value={`${formatQty(qty, 2)} ${p.unit}`} />
          <Stat label="Reservado" value={`${formatQty(reserved, 2)} ${p.unit}`} />
          <Stat label="Disponível" value={`${formatQty(dec(qty).minus(reserved), 2)} ${p.unit}`} tone={dec(qty).minus(reserved).lt(dec(p.minStock)) ? "warn" : "default"} hint={`mínimo ${formatQty(p.minStock, 2)}`} />
          {showCost && <Stat label="Valor em estoque (custo médio)" value={formatMoney(value)} />}
        </Grid>
      )}
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {p.tracksStock && (
            <Card title="Saldo por depósito">
              <DataTable rows={balances} empty="Sem saldo." columns={[
                { key: "w", label: "Depósito", render: (b) => `${wh.get(b.warehouseId)?.code ?? ""} — ${wh.get(b.warehouseId)?.name ?? ""}` },
                { key: "q", label: "Quantidade", align: "right", render: (b) => formatQty(b.quantity, 2) },
                { key: "r", label: "Reservado", align: "right", render: (b) => formatQty(b.reserved, 2) },
                ...(showCost ? [{ key: "c", label: "Custo médio", align: "right" as const, render: (b: (typeof balances)[number]) => formatMoney(b.avgCost) }, { key: "v", label: "Valor", align: "right" as const, render: (b: (typeof balances)[number]) => formatMoney(b.value) }] : []),
              ]} />
            </Card>
          )}
          {p.tracksStock && (
            <Card title="Kardex (últimos 50 movimentos)" actions={<Link className="text-sm text-brand-700" href={`/app/estoque/movimentos?produto=${p.id}`}>ver todos</Link>}>
              <DataTable rows={movements} empty="Sem movimentos." dense columns={[
                { key: "d", label: "Data", render: (m) => formatCivil(m.date) }, { key: "n", label: "Número", render: (m) => m.number },
                { key: "t", label: "Tipo", render: (m) => MOVEMENT_LABEL[m.type] ?? m.type }, { key: "w", label: "Depósito", render: (m) => wh.get(m.warehouseId)?.code ?? "" },
                { key: "q", label: "Quantidade", align: "right", render: (m) => formatQty(m.quantity, 2) },
                ...(showCost ? [{ key: "c", label: "Custo", align: "right" as const, render: (m: (typeof movements)[number]) => formatMoney(m.totalCost) }, { key: "s", label: "Saldo", align: "right" as const, render: (m: (typeof movements)[number]) => `${formatQty(m.balanceQty, 2)} · ${formatMoney(m.balanceValue)}` }] : [{ key: "s", label: "Saldo", align: "right" as const, render: (m: (typeof movements)[number]) => formatQty(m.balanceQty, 2) }]),
                { key: "r", label: "Histórico", render: (m) => m.reason ?? "—" },
              ]} />
            </Card>
          )}
        </div>
        <Card title="Cadastro">
          {ctx.permissions.has("inventory.write") ? (
            <ActionForm action={saveProductAction}>
              <ProductFields categories={categories.map((c) => ({ value: c.id, label: c.name }))} accounts={accounts} v={{ ...p, salePrice: p.salePrice.toString(), minStock: p.minStock.toString(), maxStock: p.maxStock?.toString() ?? null }} />
              <SubmitButton>Salvar</SubmitButton>
            </ActionForm>
          ) : (
            <DefinitionList items={[{ label: "Unidade", value: p.unit }, { label: "Preço de venda", value: formatMoney(p.salePrice) }, { label: "NCM", value: p.ncm ?? "—" }, { label: "Código de barras", value: p.barcode ?? "—" }]} />
          )}
        </Card>
      </div>
    </>
  );
}
