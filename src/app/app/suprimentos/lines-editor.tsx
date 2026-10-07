"use client";
import { useState } from "react";

const KINDS = [["SERVICE", "Serviço"], ["PROFESSIONAL", "Profissional (PJ/parceiro)"], ["LICENSE", "Licença"], ["SUBSCRIPTION", "Assinatura"], ["EQUIPMENT", "Equipamento"], ["MATERIAL", "Material"]];
const cls = "w-full rounded border border-slate-300 px-2 py-1 text-sm";

/** Itens dinâmicos (requisição/pedido). */
export function LinesEditor({ priceLabel = "Preço unitário estimado", withUnit = true }: { priceLabel?: string; withUnit?: boolean }) {
  const [rows, setRows] = useState([0]);
  return (
    <fieldset className="rounded border border-slate-200 p-3">
      <legend className="px-1 text-xs font-medium">Itens</legend>
      {rows.map((r, i) => (
        <div key={r} className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-6">
          <select name="lineKind[]" aria-label="Tipo" className={cls}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <input name="lineDescription[]" placeholder="Descrição" aria-label="Descrição" className={`${cls} md:col-span-2`} />
          <input name="lineQuantity[]" placeholder="Qtd." aria-label="Quantidade" defaultValue="1" className={cls} />
          {withUnit && <input name="lineUnit[]" placeholder="Unid." aria-label="Unidade" defaultValue="UN" className={cls} />}
          <input name={withUnit ? "linePrice[]" : "linePrice[]"} placeholder={priceLabel} aria-label={priceLabel} className={cls} />
          {rows.length > 1 && <button type="button" className="text-left text-xs text-red-700" onClick={() => setRows(rows.filter((_, j) => j !== i))}>remover</button>}
        </div>
      ))}
      <button type="button" className="text-xs text-brand-700" onClick={() => setRows([...rows, Math.max(...rows) + 1])}>+ item</button>
    </fieldset>
  );
}
