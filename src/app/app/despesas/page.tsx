import { PageHeader, Card, StatusBadge } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { ActionButton, ActionForm, Checkbox, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pageAnyPerm } from "@/server/page-guard";
import { lookups, nameMap } from "@/modules/config/lookups";
import { pageQuery, sp, type SearchParams } from "@/lib/query";
import { formatCivil, todayIn } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { statusLabel } from "@/lib/labels";
import { createExpenseAction, requestAdvanceAction, approveAdvanceAction, settleAdvanceAction } from "./actions";

export const metadata = { title: "Despesas" };
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pageAnyPerm(ctx, "expense.write", "expense.approve");
  const q = pageQuery(s);
  const seeAll = ctx.permissions.has("expense.approve") || ctx.permissions.has("finance.read");
  const status = sp(s, "status");
  const where = { AND: [seeAll ? {} : { professionalId: ctx.professionalId ?? "__none__" }, status ? { status } : {}] };
  const [rows, total, advances, cats, projects, ccs] = await Promise.all([
    ctx.db.expense.findMany({ where, orderBy: { date: "desc" }, skip: q.skip, take: q.take }), ctx.db.expense.count({ where }),
    ctx.db.expenseAdvance.findMany({ where: seeAll ? {} : { professionalId: ctx.professionalId ?? "__none__" }, orderBy: { createdAt: "desc" }, take: 30 }),
    lookups.expenseCategories(ctx), ctx.db.project.findMany({ where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } } }), lookups.costCenters(ctx),
  ]);
  const [profs, catNames, projNames] = await Promise.all([nameMap(ctx, "professional", [...rows.map((r) => r.professionalId), ...advances.map((a) => a.professionalId)]), nameMap(ctx, "expenseCategory", rows.map((r) => r.categoryId)), nameMap(ctx, "project", rows.map((r) => r.projectId))]);
  const myAdvances = advances.filter((a) => a.professionalId === ctx.professionalId && ["APPROVED", "PAID"].includes(a.status));
  return (
    <>
      <PageHeader title="Despesas e reembolsos" subtitle="Cada despesa separa custo da empresa, valor devido ao profissional e valor cobrável do cliente." breadcrumbs={[{ label: "Operação" }, { label: "Despesas" }]} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Toolbar base="/app/despesas" params={s} filters={[{ name: "status", label: "Situação", options: ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"].map((v) => ({ value: v, label: statusLabel(v) })) }]} />
          <DataTable rows={rows} rowHref={(e) => `/app/despesas/${e.id}`} columns={[
            { key: "date", label: "Data", render: (e) => formatCivil(e.date) }, { key: "p", label: "Profissional", render: (e) => profs.get(e.professionalId ?? "") ?? "Empresa" }, { key: "c", label: "Categoria", render: (e) => catNames.get(e.categoryId) },
            { key: "pr", label: "Projeto", render: (e) => projNames.get(e.projectId ?? "") ?? "—" }, { key: "description", label: "Descrição" },
            { key: "a", label: "Custo", align: "right", render: (e) => formatMoney(e.amount) }, { key: "r", label: "Devido ao prof.", align: "right", render: (e) => formatMoney(e.reimbursableToProfessional) }, { key: "b", label: "Cobrável", align: "right", render: (e) => formatMoney(e.billableAmount) },
            { key: "s", label: "Situação", render: (e) => <StatusBadge status={e.status} /> },
          ]} />
          <Pagination base="/app/despesas" params={s} page={q.page} pageSize={q.pageSize} total={total} />
          <Card title="Adiantamentos">
            <DataTable dense rows={advances} columns={[{ key: "p", label: "Profissional", render: (a) => profs.get(a.professionalId) }, { key: "purpose", label: "Finalidade" }, { key: "a", label: "Valor", align: "right", render: (a) => formatMoney(a.amount) }, { key: "s2", label: "Prestado", align: "right", render: (a) => formatMoney(a.settledAmount) }, { key: "s", label: "Situação", render: (a) => <StatusBadge status={a.status} /> },
              { key: "x", label: "", render: (a) => ctx.permissions.has("expense.approve") && (a.status === "REQUESTED" ? <ActionButton action={approveAdvanceAction} fields={{ id: a.id }}>Aprovar</ActionButton> : ["APPROVED", "PAID"].includes(a.status) ? <ActionButton action={settleAdvanceAction} fields={{ id: a.id }}>Prestar contas</ActionButton> : null) }]} empty={<p className="text-sm text-slate-500">Nenhum.</p>} />
            {ctx.professionalId && <ActionForm action={requestAdvanceAction} resetOnSuccess className="mt-3"><FormGrid cols={3}><Input name="amount" label="Valor" required /><Input name="purpose" label="Finalidade" required /><Select name="projectId" label="Projeto" options={projects.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` }))} placeholder="—" /></FormGrid><SubmitButton variant="secondary">Solicitar adiantamento</SubmitButton></ActionForm>}
          </Card>
        </div>
        {ctx.permissions.has("expense.write") && (
          <Card title="Nova despesa">
            <ActionForm action={createExpenseAction}>
              <FormGrid cols={2}><Input name="date" type="date" label="Data" required defaultValue={todayIn(ctx.timezone)} /><Input name="amount" label="Valor" required /></FormGrid>
              <Select name="categoryId" label="Categoria" options={cats} required placeholder="Selecione" />
              <Input name="description" label="Descrição" required />
              <Select name="paidBy" label="Pago por" options={[{ value: "PROFESSIONAL", label: "Profissional (reembolso devido)" }, { value: "COMPANY", label: "Empresa (cartão/conta corporativa)" }]} />
              <Select name="projectId" label="Projeto" options={projects.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` }))} placeholder="—" />
              <Select name="costCenterId" label="ou Centro de custo" options={ccs} placeholder="—" />
              {myAdvances.length > 0 && <Select name="advanceId" label="Vincular a adiantamento" options={myAdvances.map((a) => ({ value: a.id, label: `${a.purpose} (${formatMoney(a.amount)})` }))} placeholder="—" />}
              <Checkbox name="billableToClient" label="Cobrável do cliente (reembolso via medição)" />
              <Input name="billableAmount" label="Valor cobrável (vazio = valor integral)" />
              <SubmitButton>Registrar e anexar comprovante</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
