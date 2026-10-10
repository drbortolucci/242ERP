import type { Ctx } from "@/server/context";

export async function warehouseOptions(ctx: Ctx) {
  return (await ctx.db.warehouse.findMany({ where: { active: true }, orderBy: { code: "asc" } })).map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` }));
}
export async function productOptions(ctx: Ctx, onlyStock = false) {
  return (await ctx.db.product.findMany({ where: { active: true, ...(onlyStock ? { tracksStock: true } : {}) }, orderBy: { code: "asc" } })).map((p) => ({ value: p.id, label: `${p.code} — ${p.name}`, price: p.salePrice.toString(), unit: p.unit }));
}
export const PRODUCT_KINDS = [{ value: "GOODS", label: "Mercadoria para revenda" }, { value: "MATERIAL", label: "Material de uso/consumo ou aplicado em serviço" }, { value: "FINISHED", label: "Produto de fabricação própria" }];
export const productKindLabel = (k: string) => PRODUCT_KINDS.find((x) => x.value === k)?.label ?? k;
