import { notFound } from "next/navigation";
import { PageHeader, Card, StatusBadge, Notice } from "@/components/ui/page";
import { ActionButton, ActionForm, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { formatCivil } from "@/lib/dates";
import { dec, formatQty } from "@/lib/money";
import { cancelCountAction, postCountAction, saveCountAction } from "../../actions";

export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  pagePerm(ctx, "inventory.read");
  const c = await ctx.db.inventoryCount.findFirst({ where: { id } });
  if (!c) notFound();
  const [lines, wh] = await Promise.all([ctx.db.inventoryCountLine.findMany({ where: { countId: id } }), ctx.db.warehouse.findFirst({ where: { id: c.warehouseId } })]);
  const prods = new Map((await ctx.db.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } } })).map((p) => [p.id, p]));
  const sorted = [...lines].sort((a, b) => (prods.get(a.productId)?.code ?? "").localeCompare(prods.get(b.productId)?.code ?? ""));
  const open = c.status === "OPEN" && ctx.permissions.has("inventory.adjust");
  const counted = lines.filter((l) => l.countedQty !== null).length;
  return (
    <>
      <PageHeader title={`Inventário ${c.number}`} subtitle={<><StatusBadge status={c.status} /> · {wh?.code} — {wh?.name} · {formatCivil(c.date)} · {counted}/{lines.length} contados</>} breadcrumbs={[{ label: "Estoque" }, { label: "Inventários", href: "/app/estoque/inventarios" }, { label: c.number }]}
        actions={open && <div className="flex gap-2"><ActionButton action={postCountAction} fields={{ id }} variant="primary" confirm="Encerrar o inventário e lançar os ajustes das diferenças?">Encerrar e ajustar</ActionButton><ActionButton action={cancelCountAction} fields={{ id }} confirm="Cancelar o inventário? Nada será ajustado.">Cancelar</ActionButton></div>} />
      {open && <Notice>Informe as quantidades contadas e grave. Itens deixados em branco não são ajustados. O saldo do sistema é reavaliado no encerramento.</Notice>}
      <Card className="mt-4">
        <ActionForm action={saveCountAction} noImplicitSubmit>
          <input type="hidden" name="countId" value={id} />
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-1">Código</th><th>Produto</th><th className="text-right">Saldo na abertura</th><th className="text-right">Contado</th><th className="text-right">Diferença</th></tr></thead>
            <tbody>
              {sorted.map((l) => {
                const p = prods.get(l.productId);
                const diff = l.countedQty !== null ? dec(l.countedQty).minus(dec(l.systemQty)) : null;
                return (
                  <tr key={l.id} className="border-b">
                    <td className="py-1">{p?.code}</td><td>{p?.name}</td><td className="text-right">{formatQty(l.systemQty, 2)} {p?.unit}</td>
                    <td className="text-right">{open ? <><input type="hidden" name="lineId[]" value={l.id} /><input name="counted[]" aria-label={`Contado ${p?.code}`} defaultValue={l.countedQty?.toString() ?? ""} className="w-28 rounded border border-slate-300 px-2 py-0.5 text-right" /></> : l.countedQty !== null ? formatQty(l.countedQty, 2) : "—"}</td>
                    <td className={`text-right ${diff && !diff.isZero() ? (diff.lt(0) ? "text-red-700" : "text-emerald-700") : ""}`}>{diff ? formatQty(diff, 2) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {open && <div className="mt-3"><SubmitButton variant="secondary">Gravar contagem</SubmitButton></div>}
        </ActionForm>
      </Card>
    </>
  );
}
