import { PageHeader, Card } from "@/components/ui/page";
import { ActionForm, Input, SubmitButton } from "@/components/ui/form";
import { pagePerm } from "@/server/page-guard";
import { requireCtx } from "@/server/auth/next";
import { savePaymentTermAction } from "../special-actions";

type Inst = { days: number; percent: string };
export default async function TermsPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "settings.manage");
  const terms = await ctx.db.paymentTerm.findMany({ orderBy: { name: "asc" } });
  const form = (t?: (typeof terms)[number]) => {
    const inst = ((t?.installments as Inst[]) ?? []).concat(Array.from({ length: 6 }, () => ({ days: 0, percent: "" }))).slice(0, 6);
    return (
      <ActionForm action={savePaymentTermAction}>
        {t && <input type="hidden" name="id" value={t.id} />}
        <Input name="name" label="Nome" defaultValue={t?.name ?? ""} required />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">{inst.map((x, i) => <div key={i} className="space-y-1 rounded border p-1"><Input name="days[]" label={`Parcela ${i + 1}: dias`} type="number" defaultValue={x.percent ? String(x.days) : ""} /><Input name="percents[]" label="%" defaultValue={x.percent} /></div>)}</div>
        <p className="text-xs text-slate-500">Soma dos percentuais deve ser 100%. Parcelas são calculadas com arredondamento e a diferença de centavos vai para a última.</p>
        <SubmitButton>{t ? "Salvar" : "Criar condição"}</SubmitButton>
      </ActionForm>
    );
  };
  return (
    <>
      <PageHeader title="Condições de pagamento" breadcrumbs={[{ label: "Configurador", href: "/app/config" }, { label: "Condições de pagamento" }]} />
      <div className="space-y-4">
        {terms.map((t) => <details key={t.id} className="rounded-lg border bg-white p-3"><summary className="cursor-pointer font-medium">{t.name} — {(t.installments as Inst[]).map((i) => `${i.percent}% em ${i.days}d`).join(" + ")}</summary><div className="mt-3">{form(t)}</div></details>)}
        <Card title="Nova condição">{form()}</Card>
      </div>
    </>
  );
}
