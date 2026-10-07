import { PageHeader, StatusBadge, Badge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { nameMap } from "@/modules/config/lookups";
import { hourBankSummary } from "@/modules/ams/hour-bank";
import { formatMoney, formatQty } from "@/lib/money";

export const metadata = { title: "Saldos e franquias" };
export default async function HourBanksPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "ams.manage");
  const contracts = await ctx.db.contract.findMany({ where: { commercialModel: "AMS_RECURRING", status: { in: ["ACTIVE", "SUSPENDED", "ENDED"] } }, orderBy: { number: "asc" } });
  const [rows, pn] = await Promise.all([Promise.all(contracts.map(async (c) => ({ id: c.id, c, s: await hourBankSummary(ctx, c.id) }))), nameMap(ctx, "party", contracts.map((c) => c.partyId))]);
  return (
    <>
      <PageHeader title="Saldos de horas e franquias AMS" breadcrumbs={[{ label: "AMS" }, { label: "Saldos e franquias" }]} />
      <DataTable rows={rows} rowHref={(r) => `/app/ams/saldos/${r.id}`} columns={[
        { key: "n", label: "Contrato", render: (r) => `${r.c.number} — ${r.c.title}` }, { key: "p", label: "Cliente", render: (r) => pn.get(r.c.partyId) },
        { key: "f", label: "Franquia/mês", align: "right", render: (r) => `${formatQty(r.s.franchise)} h` },
        { key: "pol", label: "Banco", render: (r) => ({ ACCUMULATE: `Acumula ${r.c.hourBankExpiryMonths ?? 0} mês(es)`, PREPAID: "Pré-pago", NONE: "Não acumula" } as Record<string, string>)[r.c.hourBankPolicy ?? "NONE"] },
        { key: "m", label: "Consumido no mês", align: "right", render: (r) => `${formatQty(r.s.consumedMonth)} h` },
        { key: "a", label: "Saldo disponível", align: "right", render: (r) => <>{formatQty(r.s.available)} h {r.s.lowBalance && <Badge tone="amber">baixo</Badge>}</> },
        { key: "e", label: "Vence em 30 dias", align: "right", render: (r) => `${formatQty(r.s.expiringSoon)} h` },
        { key: "o", label: "Excedente pendente", align: "right", render: (r) => r.s.overagePendingHours.gt(0) ? <Badge tone="red">{formatQty(r.s.overagePendingHours)} h</Badge> : "—" },
        { key: "v", label: "Excedente cobrável", align: "right", render: (r) => formatMoney(r.s.overageBillableValue) },
        { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.c.status} /> },
      ]} />
      <p className="mt-3 text-xs text-slate-500">Saldos apurados pelo razão de horas (franquias, consumo FIFO, expirações e excedentes). A apuração roda diariamente e a cada aprovação de horas.</p>
    </>
  );
}
