"use client";
import { useState } from "react";

const cls = "w-full rounded border border-slate-300 px-2 py-1 text-sm";
type Product = { value: string; label: string; price: string; unit: string };
type Line = { key: number; productId: string; quantity: string; price: string; discount: string };

const num = (s: string) => { const v = s.trim(); const n = Number(v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v); return Number.isFinite(n) ? n : 0; };
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Itens do pedido de venda de produtos: ao escolher o produto, sugere o preço de venda do cadastro. */
export function OrderLines({ products, initial }: { products: Product[]; initial?: { productId: string; quantity: string; price: string; discount: string }[] }) {
  const [rows, setRows] = useState<Line[]>((initial?.length ? initial : [{ productId: "", quantity: "1", price: "", discount: "0" }]).map((l, i) => ({ key: i, ...l })));
  const set = (k: number, patch: Partial<Line>) => setRows(rows.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const total = rows.reduce((s, r) => s + Math.max(0, Math.round(num(r.quantity) * num(r.price) * 100) / 100 - num(r.discount)), 0);
  return (
    <fieldset className="rounded border border-slate-200 p-3">
      <legend className="px-1 text-xs font-medium">Itens</legend>
      {rows.map((r) => (
        <div key={r.key} className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-6">
          <select name="lineProduct[]" aria-label="Produto" value={r.productId} className={`${cls} md:col-span-2`} onChange={(e) => { const p = products.find((x) => x.value === e.target.value); set(r.key, { productId: e.target.value, price: p ? p.price : r.price }); }}>
            <option value="">Produto…</option>
            {products.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <input name="lineQuantity[]" aria-label="Quantidade" placeholder="Qtd." value={r.quantity} onChange={(e) => set(r.key, { quantity: e.target.value })} className={cls} />
          <input name="linePrice[]" aria-label="Preço unitário" placeholder="Preço" value={r.price} onChange={(e) => set(r.key, { price: e.target.value })} className={cls} />
          <input name="lineDiscount[]" aria-label="Desconto do item" placeholder="Desconto R$" value={r.discount} onChange={(e) => set(r.key, { discount: e.target.value })} className={cls} />
          {rows.length > 1 ? <button type="button" className="text-left text-xs text-red-700" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>remover</button> : <span />}
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button type="button" className="text-xs text-brand-700" onClick={() => setRows([...rows, { key: Math.max(...rows.map((x) => x.key)) + 1, productId: "", quantity: "1", price: "", discount: "0" }])}>+ item</button>
        <span className="text-sm">Produtos (líquido): <b>{brl(total)}</b></span>
      </div>
    </fieldset>
  );
}
