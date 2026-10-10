import Link from "next/link";
import { PageHeader, Notice } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { replenishment } from "@/modules/inventory/service";
import { formatMoney, formatQty, sum } from "@/lib/money";

export const metadata = { title: "Reposição de estoque" };
export default async function ReplenishmentPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "inventory.read");
  const rows = await replenishment(ctx);
  return (
    <>
      <PageHeader title="Sugestão de reposição" subtitle="Itens com disponível abaixo do mínimo; sugestão = máximo (ou 2 × mínimo) − disponível" breadcrumbs={[{ label: "Estoque" }, { label: "Reposição" }]} />
      <Notice>A estimativa usa o último custo de compra. Gere a requisição ou o pedido em <Link className="underline" href="/app/suprimentos/pedidos">Suprimentos › Pedidos de compra</Link>.</Notice>
      <div className="mt-4">
        <DataTable rows={rows.map((r) => ({ ...r, id: r.product.id }))} rowHref={(r) => `/app/estoque/produtos/${r.product.id}`} empty="Nenhum item abaixo do mínimo." columns={[
          { key: "c", label: "Código", render: (r) => r.product.code }, { key: "n", label: "Produto", render: (r) => r.product.name },
          { key: "a", label: "Disponível", align: "right", render: (r) => formatQty(r.available, 2) }, { key: "m", label: "Mínimo", align: "right", render: (r) => formatQty(r.product.minStock, 2) },
          { key: "x", label: "Máximo", align: "right", render: (r) => (r.product.maxStock ? formatQty(r.product.maxStock, 2) : "—") },
          { key: "s", label: "Sugerido", align: "right", render: (r) => `${formatQty(r.suggested, 2)} ${r.product.unit}` },
          { key: "e", label: "Custo estimado", align: "right", render: (r) => formatMoney(r.estimatedCost) },
        ]} />
        {rows.length > 0 && <p className="mt-2 text-right text-sm">Total estimado: <b>{formatMoney(sum(rows.map((r) => r.estimatedCost)))}</b></p>}
      </div>
    </>
  );
}
