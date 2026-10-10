import { Checkbox, FormGrid, Input, MoneyInput, Select, Textarea } from "@/components/ui/form";
import { PRODUCT_KINDS } from "./lookups";

type Opt = { value: string; label: string };
export interface ProductFormValues { id?: string; code?: string; name?: string; description?: string | null; categoryId?: string | null; kind?: string; unit?: string; barcode?: string | null; ncm?: string | null; origin?: string | null; salePrice?: string; minStock?: string; maxStock?: string | null; tracksStock?: boolean; revenueAccountId?: string | null; costAccountId?: string | null; active?: boolean }

/** Campos do cadastro de produto (usado na criação e na edição). */
export function ProductFields({ v = {}, categories, accounts }: { v?: ProductFormValues; categories: Opt[]; accounts: Opt[] }) {
  return (
    <>
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <FormGrid cols={2}>
        <Input name="code" label="Código (SKU)" defaultValue={v.code} required maxLength={40} />
        <Input name="unit" label="Unidade" defaultValue={v.unit ?? "UN"} required maxLength={6} hint="UN, KG, CX, M, L…" />
      </FormGrid>
      <Input name="name" label="Nome" defaultValue={v.name} required />
      <FormGrid cols={2}>
        <Select name="kind" label="Tipo" options={PRODUCT_KINDS} defaultValue={v.kind ?? "GOODS"} />
        <Select name="categoryId" label="Categoria" options={categories} placeholder="—" defaultValue={v.categoryId ?? ""} />
      </FormGrid>
      <FormGrid cols={3}>
        <MoneyInput name="salePrice" label="Preço de venda" defaultValue={v.salePrice ?? "0"} />
        <Input name="minStock" label="Estoque mínimo" defaultValue={v.minStock ?? "0"} />
        <Input name="maxStock" label="Estoque máximo" defaultValue={v.maxStock ?? ""} />
      </FormGrid>
      <FormGrid cols={3}>
        <Input name="barcode" label="Código de barras (GTIN)" defaultValue={v.barcode ?? ""} />
        <Input name="ncm" label="NCM" defaultValue={v.ncm ?? ""} hint="Informado pela empresa" />
        <Input name="origin" label="Origem da mercadoria" defaultValue={v.origin ?? ""} hint="Informada pela empresa" />
      </FormGrid>
      <FormGrid cols={2}>
        <Select name="revenueAccountId" label="Conta gerencial de receita" options={accounts} placeholder="Padrão: venda de mercadorias" defaultValue={v.revenueAccountId ?? ""} />
        <Select name="costAccountId" label="Conta gerencial de custo" options={accounts} placeholder="Padrão: custo das mercadorias vendidas" defaultValue={v.costAccountId ?? ""} />
      </FormGrid>
      <Textarea name="description" label="Descrição" defaultValue={v.description ?? ""} />
      <div className="flex gap-6">
        <Checkbox name="tracksStock" label="Controla estoque" defaultChecked={v.tracksStock ?? true} />
        <Checkbox name="active" label="Ativo" defaultChecked={v.active ?? true} />
      </div>
    </>
  );
}
