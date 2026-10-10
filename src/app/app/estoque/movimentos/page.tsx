import { PageHeader, Card } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { ActionButton, ActionForm, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { lookups } from "@/modules/config/lookups";
import { MOVEMENT_LABEL } from "@/modules/inventory/stock";
import { pageQuery, sp, textSearch, type SearchParams } from "@/lib/query";
import { formatCivil, todayIn } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { manualMovementAction, reverseMovementAction, transferAction } from "../actions";
import { productOptions, warehouseOptions } from "../lookups";

const MANUAL_TYPES = [{ value: "ADJUSTMENT_IN", label: "Ajuste de entrada" }, { value: "ADJUSTMENT_OUT", label: "Ajuste de saída (perda, avaria)" }, { value: "CONSUMPTION", label: "Consumo / aplicação em projeto ou centro de custo" }, { value: "OPENING", label: "Saldo inicial (implantação)" }];

export const metadata = { title: "Movimentos de estoque" };
export default async function MovementsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pagePerm(ctx, "inventory.read");
  const q = pageQuery(s, 50);
  const productId = sp(s, "produto");
  const warehouseId = sp(s, "deposito");
  const type = sp(s, "tipo");
  const where = { AND: [textSearch(q.q, ["number", "reason"]), productId ? { productId } : {}, warehouseId ? { warehouseId } : {}, type ? { type } : {}] };
  const [rows, total, products, whs, ccs, projects] = await Promise.all([
    ctx.db.stockMovement.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: q.skip, take: q.take }), ctx.db.stockMovement.count({ where }),
    productOptions(ctx, true), warehouseOptions(ctx), lookups.costCenters(ctx), ctx.db.project.findMany({ where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } }, orderBy: { code: "asc" } }),
  ]);
  const prod = new Map((await ctx.db.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } } })).map((p) => [p.id, p]));
  const wh = new Map((await ctx.db.warehouse.findMany()).map((w) => [w.id, w]));
  const reversed = new Set((await ctx.db.stockMovement.findMany({ where: { reversalOfId: { in: rows.map((r) => r.id) } }, select: { reversalOfId: true } })).map((r) => r.reversalOfId));
  const showCost = ctx.permissions.has("cost.view") || ctx.permissions.has("inventory.adjust");
  const canAdjust = ctx.permissions.has("inventory.adjust");
  const today = todayIn(ctx.timezone);
  return (
    <>
      <PageHeader title="Movimentos de estoque" subtitle="Entradas, saídas, transferências e ajustes — imutáveis; correção por estorno" breadcrumbs={[{ label: "Estoque" }, { label: "Movimentos" }]} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Toolbar base="/app/estoque/movimentos" params={s} filters={[{ name: "produto", label: "Produto", options: products }, { name: "deposito", label: "Depósito", options: whs }, { name: "tipo", label: "Tipo", options: Object.entries(MOVEMENT_LABEL).map(([value, label]) => ({ value, label })) }]} />
          <DataTable rows={rows} dense empty="Nenhum movimento." columns={[
            { key: "d", label: "Data", render: (m) => formatCivil(m.date) }, { key: "n", label: "Número", render: (m) => m.number },
            { key: "p", label: "Produto", render: (m) => prod.get(m.productId)?.code ?? "" }, { key: "w", label: "Depósito", render: (m) => wh.get(m.warehouseId)?.code ?? "" },
            { key: "t", label: "Tipo", render: (m) => MOVEMENT_LABEL[m.type] ?? m.type },
            { key: "q", label: "Qtd.", align: "right", render: (m) => formatQty(m.quantity, 2) },
            ...(showCost ? [{ key: "c", label: "Custo", align: "right" as const, render: (m: (typeof rows)[number]) => formatMoney(m.totalCost) }] : []),
            { key: "r", label: "Histórico", render: (m) => m.reason ?? "—" },
            { key: "x", label: "", render: (m) => (canAdjust && m.sourceType === "MANUAL" && !m.reversalOfId && !reversed.has(m.id) ? <ActionButton action={reverseMovementAction} fields={{ id: m.id, reason: "Estorno de lançamento manual" }} confirm={`Estornar o movimento ${m.number}?`}>Estornar</ActionButton> : null) },
          ]} />
          <Pagination base="/app/estoque/movimentos" params={s} page={q.page} pageSize={q.pageSize} total={total} />
        </div>
        <div className="space-y-6">
          {canAdjust && (
            <Card title="Lançar ajuste, consumo ou saldo inicial">
              <ActionForm action={manualMovementAction} resetOnSuccess>
                <Select name="type" label="Tipo" options={MANUAL_TYPES} required />
                <Select name="productId" label="Produto" options={products} required />
                <FormGrid cols={2}><Select name="warehouseId" label="Depósito" options={whs} required /><Input name="date" type="date" label="Data" defaultValue={today} required /></FormGrid>
                <FormGrid cols={2}><Input name="quantity" label="Quantidade" required /><Input name="unitCost" label="Custo unitário" hint="Saldo inicial/ajuste de entrada; vazio = custo médio" /></FormGrid>
                <FormGrid cols={2}><Select name="projectId" label="Projeto (consumo)" options={projects.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` }))} placeholder="—" /><Select name="costCenterId" label="Centro de custo" options={ccs} placeholder="—" /></FormGrid>
                <Input name="reason" label="Motivo" required />
                <SubmitButton>Lançar</SubmitButton>
              </ActionForm>
            </Card>
          )}
          {ctx.permissions.has("inventory.write") && (
            <Card title="Transferência entre depósitos">
              <ActionForm action={transferAction} resetOnSuccess>
                <Select name="productId" label="Produto" options={products} required />
                <FormGrid cols={2}><Select name="fromWarehouseId" label="De" options={whs} required /><Select name="toWarehouseId" label="Para" options={whs} required /></FormGrid>
                <FormGrid cols={2}><Input name="quantity" label="Quantidade" required /><Input name="date" type="date" label="Data" defaultValue={today} required /></FormGrid>
                <Input name="reason" label="Observação" />
                <SubmitButton variant="secondary">Transferir</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
