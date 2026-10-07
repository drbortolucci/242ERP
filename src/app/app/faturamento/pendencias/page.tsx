import Link from "next/link";
import { PageHeader, Card, Stat, Grid, Badge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionForm, FormGrid, Input, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { nameMap } from "@/modules/config/lookups";
import { billingCandidates } from "@/modules/billing/measurement";
import { sp, type SearchParams } from "@/lib/query";
import { formatCivil, monthEnd, monthStart, todayIn } from "@/lib/dates";
import { formatMoney, money, sum } from "@/lib/money";
import { statusLabel } from "@/lib/labels";
import { createMeasurementAction } from "../actions";

const TYPE: Record<string, string> = { TIME_ENTRY: "Horas", MILESTONE: "Marcos", RECURRING_FEE: "Mensalidade", AMS_FEE: "Mensalidade AMS", AMS_OVERAGE: "Excedente AMS", EXPENSE: "Despesas" };

export const metadata = { title: "Pendências a faturar" };
export default async function PendingBillingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pagePerm(ctx, "billing.read");
  const today = todayIn(ctx.timezone);
  const from = sp(s, "de") ?? "2000-01-01";
  const to = sp(s, "ate") ?? monthEnd(today);
  const contracts = await ctx.db.contract.findMany({ where: { status: { in: ["ACTIVE", "ENDED"] } }, orderBy: { number: "asc" } });
  const rows = (await Promise.all(contracts.map(async (c) => ({ id: c.id, c, cands: await billingCandidates(ctx, c.id, from, to) })))).filter((r) => r.cands.length);
  const [pn, blocked] = await Promise.all([nameMap(ctx, "party", rows.map((r) => r.c.partyId)), ctx.db.timeEntry.groupBy({ by: ["contractId"], where: { billingStatus: "BLOCKED", status: "APPROVED" }, _sum: { hours: true } })]);
  const total = money(sum(rows.flatMap((r) => r.cands.map((x) => x.amount))));
  const canMeasure = ctx.permissions.has("billing.measure");
  return (
    <>
      <PageHeader title="Pendências a faturar" subtitle={`Itens elegíveis ainda não medidos até ${formatCivil(to)}`} breadcrumbs={[{ label: "Faturamento" }, { label: "Pendências" }]} />
      <Grid cols={3}>
        <Stat label="Valor elegível não medido" value={formatMoney(total)} />
        <Stat label="Contratos com pendências" value={rows.length} />
        <Stat label="Horas aguardando aprovação do cliente" value={blocked.reduce((a, b) => a + Number(b._sum.hours ?? 0), 0).toFixed(2)} hint="bloqueadas para faturamento" tone="warn" />
      </Grid>
      <form className="my-4 flex flex-wrap items-end gap-2 text-sm" method="get">
        <label className="flex flex-col text-xs">Até<input type="date" name="ate" defaultValue={to} className="rounded border px-2 py-1 text-sm" /></label>
        <button className="rounded bg-slate-800 px-3 py-1.5 text-white">Filtrar</button>
      </form>
      <div className="space-y-6">
        {rows.map((r) => {
          const byType = Object.entries(r.cands.reduce<Record<string, number>>((acc, x) => ({ ...acc, [x.sourceType]: (acc[x.sourceType] ?? 0) + Number(x.amount) }), {}));
          return (
            <Card key={r.id} title={<span><Link className="text-brand-700 underline" href={`/app/contratos/${r.c.id}`}>{r.c.number}</Link> — {r.c.title} · {pn.get(r.c.partyId)} <Badge>{statusLabel(r.c.commercialModel)}</Badge></span>}>
              <div className="mb-3 flex flex-wrap gap-2 text-sm">{byType.map(([t, v]) => <Badge key={t} tone="blue">{TYPE[t] ?? t}: {formatMoney(v)}</Badge>)}<Badge tone="green">Total {formatMoney(sum(r.cands.map((x) => x.amount)))}</Badge></div>
              <DataTable dense rows={r.cands.slice(0, 12).map((x) => ({ ...x, id: `${x.sourceType}|${x.sourceKey}` }))} columns={[{ key: "t", label: "Origem", render: (x) => TYPE[x.sourceType] ?? x.sourceType }, { key: "description", label: "Descrição" }, { key: "q", label: "Qtd.", align: "right", render: (x) => x.quantity }, { key: "a", label: "Valor", align: "right", render: (x) => formatMoney(x.amount) }]} />
              {r.cands.length > 12 && <p className="mt-1 text-xs text-slate-500">+ {r.cands.length - 12} item(ns)…</p>}
              {canMeasure && (
                <ActionForm action={createMeasurementAction} className="mt-3 border-t pt-3">
                  <input type="hidden" name="contractId" value={r.c.id} />
                  <FormGrid cols={4}><Input name="periodStart" type="date" label="De" defaultValue={from === "2000-01-01" ? monthStart(r.cands.map((x) => x.date).sort()[0]) : from} /><Input name="periodEnd" type="date" label="Até" defaultValue={to} /><Input name="competence" type="date" label="Competência" defaultValue={monthStart(to)} /><Input name="notes" label="Observação" /></FormGrid>
                  <SubmitButton variant="secondary">Gerar medição com todos os itens</SubmitButton>
                </ActionForm>
              )}
            </Card>
          );
        })}
        {rows.length === 0 && <p className="text-sm text-slate-500">Nenhum item elegível pendente.</p>}
      </div>
    </>
  );
}
