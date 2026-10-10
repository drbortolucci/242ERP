import { PageHeader, Card, Badge } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { ActionForm, Input, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { lookups } from "@/modules/config/lookups";
import { pageQuery, sp, textSearch, type SearchParams } from "@/lib/query";
import { dec, formatMoney, formatQty } from "@/lib/money";
import { ProductFields } from "../product-form";
import { createCategoryAction, saveProductAction } from "../actions";
import { productKindLabel, PRODUCT_KINDS } from "../lookups";

export const metadata = { title: "Produtos" };
export default async function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pagePerm(ctx, "inventory.read");
  const q = pageQuery(s);
  const kind = sp(s, "kind");
  const where = { AND: [textSearch(q.q, ["code", "name", "barcode"]), kind ? { kind } : {}] };
  const [rows, total, categories, accounts] = await Promise.all([
    ctx.db.product.findMany({ where, orderBy: { code: "asc" }, skip: q.skip, take: q.take }), ctx.db.product.count({ where }),
    ctx.db.productCategory.findMany({ where: { active: true }, orderBy: { name: "asc" } }), lookups.accounts(ctx),
  ]);
  const balances = await ctx.db.stockBalance.findMany({ where: { productId: { in: rows.map((r) => r.id) } } });
  const qtyOf = (id: string) => balances.filter((b) => b.productId === id).reduce((a, b) => a.plus(dec(b.quantity)), dec(0));
  const canWrite = ctx.permissions.has("inventory.write");
  const catOpts = categories.map((c) => ({ value: c.id, label: c.name }));
  return (
    <>
      <PageHeader title="Produtos" subtitle="Mercadorias, materiais e produtos com controle de estoque por depósito e custo médio" breadcrumbs={[{ label: "Estoque" }, { label: "Produtos" }]} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Toolbar base="/app/estoque/produtos" params={s} filters={[{ name: "kind", label: "Tipo", options: PRODUCT_KINDS }]} />
          <DataTable rows={rows} rowHref={(r) => `/app/estoque/produtos/${r.id}`} empty="Nenhum produto cadastrado." columns={[
            { key: "code", label: "Código" }, { key: "name", label: "Nome" }, { key: "k", label: "Tipo", render: (r) => productKindLabel(r.kind) },
            { key: "u", label: "Unid.", render: (r) => r.unit },
            { key: "p", label: "Preço", align: "right", render: (r) => formatMoney(r.salePrice) },
            { key: "q", label: "Saldo", align: "right", render: (r) => (r.tracksStock ? formatQty(qtyOf(r.id), 2) : "—") },
            { key: "a", label: "", render: (r) => (!r.active ? <Badge>inativo</Badge> : !r.tracksStock ? <Badge tone="blue">sem estoque</Badge> : null) },
          ]} />
          <Pagination base="/app/estoque/produtos" params={s} page={q.page} pageSize={q.pageSize} total={total} />
        </div>
        {canWrite && (
          <div className="space-y-6">
            <Card title="Novo produto">
              <ActionForm action={saveProductAction}>
                <ProductFields categories={catOpts} accounts={accounts} />
                <SubmitButton>Cadastrar produto</SubmitButton>
              </ActionForm>
            </Card>
            <Card title="Nova categoria">
              <ActionForm action={createCategoryAction} resetOnSuccess className="flex items-end gap-2">
                <Input name="name" label="Nome da categoria" required />
                <SubmitButton variant="secondary">Criar</SubmitButton>
              </ActionForm>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
