import { PageHeader, StatusBadge, Stat, Grid, Badge, Notice } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { nameMap } from "@/modules/config/lookups";
import { externalActionsAllowed } from "@/server/providers/env";
import { pageQuery, sp, textSearch, type SearchParams } from "@/lib/query";
import { formatCivil } from "@/lib/dates";
import { formatMoney, sum } from "@/lib/money";
import { statusLabel } from "@/lib/labels";

export const metadata = { title: "Cobranças bancárias" };
export default async function BankChargesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pagePerm(ctx, "finance.read");
  const q = pageQuery(s);
  const status = sp(s, "status");
  const method = sp(s, "meio");
  const where = { AND: [textSearch(q.q, ["number", "externalId"]), status ? { status } : {}, method ? { method } : {}] };
  const [rows, total, open] = await Promise.all([
    ctx.db.bankCharge.findMany({ where, orderBy: { createdAt: "desc" }, skip: q.skip, take: q.take }), ctx.db.bankCharge.count({ where }),
    ctx.db.bankCharge.findMany({ where: { status: "REGISTERED" }, select: { amount: true } }),
  ]);
  const recs = new Map((await ctx.db.receivable.findMany({ where: { id: { in: rows.map((r) => r.receivableId) } } })).map((r) => [r.id, r]));
  const pn = await nameMap(ctx, "party", [...recs.values()].map((r) => r.partyId));
  return (
    <>
      <PageHeader title="Cobranças bancárias" subtitle="Boletos e PIX emitidos para títulos a receber; a baixa chega pelo aviso do banco e liquida o título" breadcrumbs={[{ label: "Financeiro" }, { label: "Cobranças bancárias" }]} />
      {!externalActionsAllowed() && <div className="mb-4"><Notice>Ambiente simulado: nenhuma cobrança real é registrada no banco. Use “Simular pagamento” no título para testar a baixa.</Notice></div>}
      <Grid cols={2}>
        <Stat label="Cobranças registradas em aberto" value={open.length} href="/app/financeiro/cobrancas-bancarias?status=REGISTERED" />
        <Stat label="Valor em cobrança" value={formatMoney(sum(open.map((o) => o.amount)))} />
      </Grid>
      <div className="mt-6">
        <Toolbar base="/app/financeiro/cobrancas-bancarias" params={s} filters={[{ name: "status", label: "Situação", options: ["REGISTERED", "PAID", "CANCELED", "EXPIRED", "ERROR"].map((v) => ({ value: v, label: statusLabel(v) })) }, { name: "meio", label: "Meio", options: [{ value: "BOLETO", label: "Boleto" }, { value: "PIX", label: "PIX" }] }]} />
        <DataTable rows={rows} rowHref={(r) => `/app/financeiro/titulos/receber/${r.receivableId}`} empty="Nenhuma cobrança emitida." columns={[
          { key: "number", label: "Cobrança" }, { key: "t", label: "Título", render: (r) => recs.get(r.receivableId)?.number ?? "—" },
          { key: "c", label: "Cliente", render: (r) => pn.get(recs.get(r.receivableId)?.partyId ?? "") ?? "—" },
          { key: "m", label: "Meio", render: (r) => <>{r.method === "PIX" ? "PIX" : "Boleto"} {r.environment === "SIMULATED" && <Badge tone="violet">simulada</Badge>}</> },
          { key: "v", label: "Vencimento", render: (r) => formatCivil(r.dueDate) }, { key: "a", label: "Valor", align: "right", render: (r) => formatMoney(r.amount) },
          { key: "p", label: "Pago", align: "right", render: (r) => (r.paidAmount ? formatMoney(r.paidAmount) : "—") }, { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> },
        ]} />
        <Pagination base="/app/financeiro/cobrancas-bancarias" params={s} page={q.page} pageSize={q.pageSize} total={total} />
      </div>
    </>
  );
}
