import { PageHeader, Card, StatusBadge } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { ActionForm, FormGrid, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pageAnyPerm } from "@/server/page-guard";
import { lookups, nameMap, userNameMap } from "@/modules/config/lookups";
import { pageQuery, sp, textSearch, type SearchParams } from "@/lib/query";
import { formatCivil } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { statusLabel } from "@/lib/labels";
import { LinesEditor } from "../lines-editor";
import { createRequisitionAction } from "../actions";

export const metadata = { title: "Requisições de compra" };
export default async function RequisitionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pageAnyPerm(ctx, "purchase.request", "purchase.write");
  const q = pageQuery(s);
  const status = sp(s, "status");
  const where = { AND: [textSearch(q.q, ["number", "description"]), status ? { status } : {}] };
  const [rows, total, companies, ccs, accounts, projects] = await Promise.all([ctx.db.purchaseRequisition.findMany({ where, orderBy: { createdAt: "desc" }, skip: q.skip, take: q.take }), ctx.db.purchaseRequisition.count({ where }), lookups.companies(ctx), lookups.costCenters(ctx), lookups.accounts(ctx), ctx.db.project.findMany({ where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } } })]);
  const [users, projs] = await Promise.all([userNameMap(rows.map((r) => r.requesterId)), nameMap(ctx, "project", rows.map((r) => r.projectId))]);
  return (
    <>
      <PageHeader title="Requisições de compra" breadcrumbs={[{ label: "Suprimentos" }, { label: "Requisições" }]} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Toolbar base="/app/suprimentos/requisicoes" params={s} filters={[{ name: "status", label: "Situação", options: ["DRAFT", "SUBMITTED", "APPROVED", "QUOTING", "ORDERED", "REJECTED", "CANCELED"].map((v) => ({ value: v, label: statusLabel(v) })) }]} />
          <DataTable rows={rows} rowHref={(r) => `/app/suprimentos/requisicoes/${r.id}`} columns={[{ key: "number", label: "Número" }, { key: "description", label: "Descrição" }, { key: "req", label: "Solicitante", render: (r) => users.get(r.requesterId) }, { key: "p", label: "Projeto", render: (r) => projs.get(r.projectId ?? "") ?? "—" }, { key: "e", label: "Estimado", align: "right", render: (r) => formatMoney(r.estimatedAmount) }, { key: "b", label: "Orçamento", render: (r) => { const b = r.budgetCheck as { ok?: boolean; hasBudget?: boolean } | null; return !b?.hasBudget ? "sem referência" : b.ok ? "OK" : "insuficiente"; } }, { key: "n", label: "Necessário em", render: (r) => formatCivil(r.neededBy) }, { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> }]} />
          <Pagination base="/app/suprimentos/requisicoes" params={s} page={q.page} pageSize={q.pageSize} total={total} />
        </div>
        {ctx.permissions.has("purchase.request") && (
          <Card title="Nova requisição">
            <ActionForm action={createRequisitionAction}>
              <Select name="companyId" label="Empresa" options={companies} required />
              <Input name="description" label="Descrição" required />
              <Select name="projectId" label="Projeto" options={projects.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` }))} placeholder="—" />
              <FormGrid cols={2}><Select name="costCenterId" label="Centro de custo" options={ccs} placeholder="—" /><Select name="accountId" label="Conta gerencial" options={accounts} placeholder="—" /></FormGrid>
              <Input name="neededBy" type="date" label="Necessário em" />
              <Textarea name="justification" label="Justificativa" />
              <LinesEditor />
              <SubmitButton>Registrar (verifica orçamento)</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
