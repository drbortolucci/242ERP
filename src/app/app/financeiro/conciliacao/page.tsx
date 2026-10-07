import { PageHeader, Card, Badge } from "@/components/ui/page";
import { ActionForm, Input, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { suggestMatches } from "@/modules/finance/treasury";
import { sp, type SearchParams } from "@/lib/query";
import { formatCivil } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { reconcileAction, createFromLineAction, ignoreLineAction, unreconcileAction } from "../actions";
import { StatementForm } from "./statement-form";

export const metadata = { title: "Conciliação bancária" };
export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pagePerm(ctx, "treasury.manage");
  const accounts = await ctx.db.bankAccount.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const accountId = sp(s, "conta") ?? accounts[0]?.id;
  const [pending, done] = await Promise.all([
    ctx.db.bankStatementLine.findMany({ where: { bankAccountId: accountId, status: "PENDING" }, orderBy: { date: "asc" }, take: 50 }),
    ctx.db.bankStatementLine.findMany({ where: { bankAccountId: accountId, status: { not: "PENDING" } }, orderBy: { date: "desc" }, take: 20 }),
  ]);
  const suggestions = await Promise.all(pending.map((l) => suggestMatches(ctx, l.id).then((m) => ({ id: l.id, m }))));
  return (
    <>
      <PageHeader title="Conciliação bancária" breadcrumbs={[{ label: "Financeiro" }, { label: "Conciliação" }]} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">{accounts.map((a) => <a key={a.id} href={`?conta=${a.id}`} className={`rounded border px-3 py-1 ${a.id === accountId ? "bg-slate-800 text-white" : ""}`}>{a.name}</a>)}</div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title={`Linhas de extrato pendentes (${pending.length})`}>
            {pending.length === 0 && <p className="text-sm text-slate-500">Nada a conciliar nesta conta.</p>}
            <ul className="space-y-3">
              {pending.map((l) => {
                const sug = suggestions.find((x) => x.id === l.id)?.m ?? [];
                return (
                  <li key={l.id} className="rounded border border-slate-200 p-3 text-sm">
                    <div className="flex flex-wrap justify-between gap-2"><span><b>{formatCivil(l.date)}</b> — {l.description}</span><span className={Number(l.amount) < 0 ? "text-red-700" : "text-emerald-700"}>{formatMoney(l.amount)}</span></div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {sug.map((t) => <ActionForm key={t.id} action={reconcileAction}><input type="hidden" name="lineId" value={l.id} /><input type="hidden" name="transactionId" value={t.id} /><SubmitButton variant="secondary">Conciliar com {formatCivil(t.date)} · {t.description}</SubmitButton></ActionForm>)}
                      {sug.length === 0 && <Badge tone="amber">sem movimento correspondente no livro</Badge>}
                      <ActionForm action={createFromLineAction} className="flex items-end gap-1"><input type="hidden" name="lineId" value={l.id} /><Input name="description" aria-label="Descrição do lançamento" placeholder="Ex.: tarifa bancária" /><SubmitButton variant="secondary">Lançar e conciliar</SubmitButton></ActionForm>
                      <ActionForm action={ignoreLineAction} className="flex items-end gap-1"><input type="hidden" name="lineId" value={l.id} /><Input name="reason" aria-label="Motivo" placeholder="Motivo" required /><SubmitButton variant="secondary">Ignorar</SubmitButton></ActionForm>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card title="Conciliadas/ignoradas recentemente">
            <ul className="space-y-1 text-sm">{done.map((l) => <li key={l.id} className="flex flex-wrap items-center justify-between gap-2"><span>{formatCivil(l.date)} — {l.description} · {formatMoney(l.amount)} <Badge tone={l.status === "RECONCILED" ? "green" : "slate"}>{l.status === "RECONCILED" ? "conciliada" : "ignorada"}</Badge></span><ActionForm action={unreconcileAction} className="flex items-end gap-1"><input type="hidden" name="lineId" value={l.id} /><input type="hidden" name="reason" value="Desfeito pelo usuário" /><SubmitButton variant="secondary">Desfazer</SubmitButton></ActionForm></li>)}</ul>
          </Card>
        </div>
        <Card title="Importar extrato"><StatementForm accounts={accounts.map((a) => ({ value: a.id, label: a.name }))} /></Card>
      </div>
    </>
  );
}
