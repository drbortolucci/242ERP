import { PageHeader, Card, StatusBadge, Stat, Grid } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { ActionForm, FormGrid, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pageAnyPerm } from "@/server/page-guard";
import { lookups, nameMap } from "@/modules/config/lookups";
import { openCommitments } from "@/modules/procurement/service";
import { pageQuery, sp, textSearch, type SearchParams } from "@/lib/query";
import { formatCivil, todayIn } from "@/lib/dates";
import { formatMoney, sum } from "@/lib/money";
import { statusLabel } from "@/lib/labels";
import { LinesEditor } from "../lines-editor";
import { createPoAction } from "../actions";
import { PO_KINDS, poKindLabel } from "../constants";


export const metadata = { title: "Pedidos de compra" };
export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pageAnyPerm(ctx, "purchase.write", "purchase.approve", "purchase.receive");
  const q = pageQuery(s);
  const status = sp(s, "status");
  const kind = sp(s, "kind");
  const where = { AND: [textSearch(q.q, ["number", "notes"]), status ? { status } : {}, kind ? { kind } : {}] };
  const [rows, total, commitments, companies, suppliers, ccs, accounts, terms, projects] = await Promise.all([
    ctx.db.purchaseOrder.findMany({ where, orderBy: { createdAt: "desc" }, skip: q.skip, take: q.take }), ctx.db.purchaseOrder.count({ where }), openCommitments(ctx),
    lookups.companies(ctx), lookups.suppliers(ctx), lookups.costCenters(ctx), lookups.accounts(ctx), lookups.paymentTerms(ctx), ctx.db.project.findMany({ where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } } }),
  ]);
  const [sn, pn] = await Promise.all([nameMap(ctx, "party", rows.map((r) => r.supplierPartyId)), nameMap(ctx, "project", rows.map((r) => r.projectId))]);
  const pending = await ctx.db.purchaseOrder.count({ where: { status: "PENDING_APPROVAL" } });
  return (
    <>
      <PageHeader title="Pedidos de compra e contratações" breadcrumbs={[{ label: "Suprimentos" }, { label: "Pedidos" }]} />
      <Grid cols={3}>
        <Stat label="Compromissos abertos (não faturados)" value={formatMoney(sum(commitments.map((c) => c.open)))} hint={`${commitments.length} pedidos`} />
        <Stat label="Recebido/aceito não faturado" value={formatMoney(sum(commitments.map((c) => c.received.minus(c.invoiced).gt(0) ? c.received.minus(c.invoiced) : 0)))} />
        <Stat label="Aguardando aprovação" value={pending} href="/app/suprimentos/pedidos?status=PENDING_APPROVAL" tone={pending ? "warn" : "default"} />
      </Grid>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Toolbar base="/app/suprimentos/pedidos" params={s} filters={[{ name: "status", label: "Situação", options: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELED"].map((v) => ({ value: v, label: statusLabel(v) })) }, { name: "kind", label: "Tipo", options: PO_KINDS }]} />
          <DataTable rows={rows} rowHref={(r) => `/app/suprimentos/pedidos/${r.id}`} columns={[
            { key: "number", label: "Número" }, { key: "s", label: "Fornecedor", render: (r) => sn.get(r.supplierPartyId) },
            { key: "k", label: "Tipo", render: (r) => poKindLabel(r.kind) },
            { key: "p", label: "Projeto", render: (r) => pn.get(r.projectId ?? "") ?? "—" }, { key: "d", label: "Data", render: (r) => formatCivil(r.orderDate) },
            { key: "t", label: "Total", align: "right", render: (r) => formatMoney(r.totalAmount) },
            { key: "o", label: "Saldo a faturar", align: "right", render: (r) => { const c = commitments.find((x) => x.po.id === r.id); return c ? formatMoney(c.open) : "—"; } },
            { key: "st", label: "Situação", render: (r) => <StatusBadge status={r.status} /> },
          ]} />
          <Pagination base="/app/suprimentos/pedidos" params={s} page={q.page} pageSize={q.pageSize} total={total} />
        </div>
        {ctx.permissions.has("purchase.write") && (
          <Card title="Pedido direto (sem cotação)">
            <ActionForm action={createPoAction}>
              <Select name="companyId" label="Empresa" options={companies} required />
              <Select name="supplierPartyId" label="Fornecedor" options={suppliers} required />
              <FormGrid cols={2}><Select name="kind" label="Tipo de contratação" options={PO_KINDS} /><Input name="orderDate" type="date" label="Data" defaultValue={todayIn(ctx.timezone)} required /></FormGrid>
              <Select name="projectId" label="Projeto" options={projects.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` }))} placeholder="—" />
              <FormGrid cols={2}><Select name="costCenterId" label="Centro de custo" options={ccs} placeholder="—" /><Select name="accountId" label="Conta gerencial" options={accounts} placeholder="—" /></FormGrid>
              <FormGrid cols={2}><Input name="startDate" type="date" label="Vigência início" /><Input name="endDate" type="date" label="Vigência fim" /></FormGrid>
              <FormGrid cols={3}><Select name="paymentTermId" label="Condição" options={terms} placeholder="—" /><Input name="advanceAmount" label="Adiantamento" defaultValue="0" /><Input name="tolerancePct" label="Tolerância %" defaultValue="0" /></FormGrid>
              <Textarea name="notes" label="Observações" />
              <LinesEditor priceLabel="Preço unitário" />
              <SubmitButton>Criar pedido</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
