import Link from "@/components/ui/access-link";
import { PageHeader, Card, StatusBadge, Badge } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { contractAlerts, contractBalances } from "@/modules/contracts/service";
import { nameMap } from "@/modules/config/lookups";
import { pageQuery, sp, textSearch, type SearchParams } from "@/lib/query";
import { formatMoney } from "@/lib/money";
import { formatCivil } from "@/lib/dates";
import { statusLabel } from "@/lib/labels";
import { ContractForm } from "./contract-form";
import { contractLookups } from "./lk";
import { createContractAction } from "./actions";

export const metadata = { title: "Contratos" };
export default async function ContractsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pagePerm(ctx, "contract.read");
  const q = pageQuery(s);
  const status = sp(s, "status");
  const where = { AND: [textSearch(q.q, ["number", "title"]), status ? { status } : {}, sp(s, "modelo") ? { commercialModel: sp(s, "modelo") } : {}] };
  const [rows, total, alerts] = await Promise.all([ctx.db.contract.findMany({ where, orderBy: { createdAt: "desc" }, skip: q.skip, take: q.take }), ctx.db.contract.count({ where }), contractAlerts(ctx)]);
  const balances = new Map(await Promise.all(rows.map(async (c) => [c.id, await contractBalances(ctx, c.id)] as const)));
  const parties = await nameMap(ctx, "party", rows.map((r) => r.partyId));
  const nNew = sp(s, "novo") === "1";
  return (
    <>
      <PageHeader title="Contratos" breadcrumbs={[{ label: "Comercial" }, { label: "Contratos" }]} actions={ctx.permissions.has("contract.write") && <Link className="rounded-md border bg-white px-3 py-1.5 text-sm" href="/app/contratos?novo=1">Contrato direto</Link>} />
      {alerts.length > 0 && (
        <Card title={`Alertas (${alerts.length})`} className="mb-6">
          <ul className="space-y-1 text-sm">{alerts.map((a, i) => <li key={i}><Badge tone={a.kind === "OVER_LIMIT" || a.kind === "MISSING_PO" ? "red" : "amber"}>{a.kind === "MISSING_PO" ? "Sem OC" : a.kind === "LOW_BALANCE" ? "Saldo baixo" : a.kind === "OVER_LIMIT" ? "Excedente" : a.kind === "RENEWAL" ? "Renovação" : "Vencimento"}</Badge> <Link className="text-brand-700 underline" href={`/app/contratos/${a.contractId}`}>{a.number}</Link> — {a.message}</li>)}</ul>
        </Card>
      )}
      {nNew && <Card title="Contrato direto (sem proposta)" className="mb-6"><ContractForm action={createContractAction} hidden={{}} lk={await contractLookups(ctx)} showParty /></Card>}
      <Toolbar base="/app/contratos" params={s} filters={[{ name: "status", label: "Situação", options: ["DRAFT", "ACTIVE", "SUSPENDED", "ENDED", "CANCELED"].map((v) => ({ value: v, label: statusLabel(v) })) }, { name: "modelo", label: "Modelo", options: ["FIXED_PRICE", "TIME_MATERIAL", "MONTHLY_ALLOCATION", "HOUR_PACKAGE", "AMS_RECURRING", "ADVISORY", "TRAINING", "HYBRID"].map((v) => ({ value: v, label: statusLabel(v) })) }]} />
      <DataTable rows={rows} rowHref={(c) => `/app/contratos/${c.id}`} columns={[
        { key: "number", label: "Número", render: (c) => `${c.number} v${c.version}` }, { key: "title", label: "Título" }, { key: "party", label: "Cliente", render: (c) => parties.get(c.partyId) },
        { key: "model", label: "Modelo", render: (c) => statusLabel(c.commercialModel) }, { key: "vig", label: "Vigência", render: (c) => `${formatCivil(c.startDate)} – ${formatCivil(c.endDate)}` },
        { key: "contracted", label: "Contratado", align: "right", render: (c) => formatMoney(balances.get(c.id)!.contracted) },
        { key: "executed", label: "Executado", align: "right", render: (c) => formatMoney(balances.get(c.id)!.executed) },
        { key: "billed", label: "Faturado", align: "right", render: (c) => formatMoney(balances.get(c.id)!.billed) },
        { key: "received", label: "Recebido", align: "right", render: (c) => formatMoney(balances.get(c.id)!.received) },
        { key: "available", label: "Saldo", align: "right", render: (c) => formatMoney(balances.get(c.id)!.available) },
        { key: "status", label: "Situação", render: (c) => <StatusBadge status={c.status} /> },
      ]} />
      <Pagination base="/app/contratos" params={s} page={q.page} pageSize={q.pageSize} total={total} />
    </>
  );
}
