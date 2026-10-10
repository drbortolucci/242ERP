import Link from "@/components/ui/access-link";
import { notFound } from "next/navigation";
import { PageHeader, Card, DefinitionList, StatusBadge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { formatMoney, formatQty } from "@/lib/money";
import { formatCivil, toCivil } from "@/lib/dates";
import { ContractForm } from "../../contratos/contract-form";
import { contractLookups } from "../../contratos/lk";
import { createContractFromOrderAction } from "../../contratos/actions";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  pagePerm(ctx, "contract.read");
  const so = await ctx.db.salesOrder.findFirst({ where: { id } });
  if (!so) notFound();
  const [party, version, lines, contract, lk] = await Promise.all([
    ctx.db.party.findFirst({ where: { id: so.partyId } }), so.proposalVersionId ? ctx.db.proposalVersion.findFirst({ where: { id: so.proposalVersionId } }) : null,
    so.proposalVersionId ? ctx.db.proposalLine.findMany({ where: { versionId: so.proposalVersionId }, orderBy: { sortOrder: "asc" } }) : [], ctx.db.contract.findFirst({ where: { salesOrderId: id, status: { not: "CANCELED" } } }), contractLookups(ctx),
  ]);
  const model = version?.commercialModel ?? "TIME_MATERIAL";
  const revenueMethod = model === "FIXED_PRICE" ? "PERCENT_COMPLETE_HOURS" : model === "AMS_RECURRING" || model === "MONTHLY_ALLOCATION" ? "STRAIGHT_LINE" : "TIME_MATERIAL";
  return (
    <>
      <PageHeader title={`Pedido ${so.number}`} subtitle={<StatusBadge status={so.status} />} breadcrumbs={[{ label: "Pedidos", href: "/app/pedidos" }, { label: so.number }]} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Pedido" className="xl:col-span-1">
          <DefinitionList items={[{ label: "Cliente", value: <Link className="text-brand-700 underline" href={`/app/cadastros/clientes/${so.partyId}`}>{party?.name}</Link> }, { label: "Valor", value: formatMoney(so.totalAmount) }, { label: "Data", value: formatCivil(so.orderDate) }, { label: "OC do cliente", value: so.customerPo }, { label: "Proposta", value: so.proposalId ? <Link className="text-brand-700 underline" href={`/app/propostas/${so.proposalId}`}>v{version?.version}</Link> : "—" }, { label: "Contrato", value: contract ? <Link className="text-brand-700 underline" href={`/app/contratos/${contract.id}`}>{contract.number}</Link> : "—" }]} />
          <h3 className="mb-2 mt-4 text-sm font-semibold">Itens (snapshot da proposta aceita)</h3>
          <DataTable dense rows={lines} columns={[{ key: "description", label: "Item" }, { key: "q", label: "Horas/Qtd", align: "right", render: (l) => formatQty(l.kind === "LABOR" ? l.hours : l.quantity) }, { key: "revenue", label: "Valor", align: "right", render: (l) => formatMoney(l.revenue) }]} />
        </Card>
        {!contract && so.status === "OPEN" && ctx.permissions.has("contract.write") && (
          <Card title="Gerar contrato — confirme os itens necessários" className="xl:col-span-2">
            <ContractForm action={createContractFromOrderAction} hidden={{ salesOrderId: id }} lk={lk} c={{ title: `${party?.tradeName ?? party?.name} — ${model}`, commercialModel: model, revenueMethod, startDate: version?.startDate ? toCivil(version.startDate) : toCivil(so.orderDate), endDate: version?.endDate ? toCivil(version.endDate) : null, totalValue: so.totalAmount.toString(), paymentTermId: version?.paymentTermId, taxRatePct: version?.taxRatePct.toString() ?? "0", hoursLimit: version && !version.totalHours.isZero() ? version.totalHours.toString() : null, requiresPo: !!so.customerPo }} />
          </Card>
        )}
      </div>
    </>
  );
}
