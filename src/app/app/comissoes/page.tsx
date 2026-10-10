import Link from "@/components/ui/access-link";
import { PageHeader, StatusBadge, Grid, Stat } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { formatMoney, sum } from "@/lib/money";
import { formatCivil } from "@/lib/dates";
import { commissionPaidAction } from "../contratos/actions";

export const metadata = { title: "Comissões" };
export default async function CommissionsPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "commission.manage");
  const [rows, rules] = await Promise.all([ctx.db.commissionEntry.findMany({ orderBy: { createdAt: "desc" }, take: 300 }), ctx.db.commissionRule.findMany()]);
  const rn = new Map(rules.map((r) => [r.id, `${r.name} (${r.basis})`]));
  const contracts = await ctx.db.contract.findMany({ where: { id: { in: rows.map((r) => r.contractId ?? "") } } });
  const cn = new Map(contracts.map((c) => [c.id, c.number]));
  const by = (st: string[]) => sum(rows.filter((r) => st.includes(r.status)).map((r) => r.amount));
  return (
    <>
      <PageHeader title="Comissões comerciais" subtitle="Regras em Configurador › Regras de comissão. Estornos e cancelamentos geram lançamentos de reversão." breadcrumbs={[{ label: "Comercial" }, { label: "Comissões" }]} />
      <Grid cols={3}><Stat label="Provisionadas (contratação)" value={formatMoney(by(["ACCRUED"]))} /><Stat label="A pagar" value={formatMoney(by(["PAYABLE"]))} /><Stat label="Pagas" value={formatMoney(by(["PAID"]))} /></Grid>
      <div className="mt-6"><DataTable rows={rows} columns={[{ key: "competence", label: "Competência", render: (r) => formatCivil(r.competence) }, { key: "rule", label: "Regra", render: (r) => rn.get(r.ruleId) }, { key: "c", label: "Contrato", render: (r) => r.contractId ? <Link className="text-brand-700 underline" href={`/app/contratos/${r.contractId}`}>{cn.get(r.contractId)}</Link> : "—" }, { key: "src", label: "Origem", render: (r) => `${r.sourceType}` }, { key: "base", label: "Base", align: "right", render: (r) => formatMoney(r.baseAmount) }, { key: "amount", label: "Comissão", align: "right", render: (r) => formatMoney(r.amount) }, { key: "status", label: "Situação", render: (r) => <StatusBadge status={r.status === "ACCRUED" ? "PENDING" : r.status} /> }, { key: "a", label: "", render: (r) => (r.status === "PAYABLE" || r.status === "ACCRUED") && r.kind === "ACCRUAL" && <ActionButton action={commissionPaidAction} fields={{ id: r.id }}>Marcar paga</ActionButton> }]} /></div>
    </>
  );
}
