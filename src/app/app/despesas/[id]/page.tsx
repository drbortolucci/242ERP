import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card, DefinitionList, StatusBadge, Notice } from "@/components/ui/page";
import { ActionButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pageAnyPerm } from "@/server/page-guard";
import { Attachments } from "@/components/attachments";
import { ApprovalPanel } from "@/components/approval-panel";
import { formatCivil } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { submitExpenseAction } from "../actions";

export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  pageAnyPerm(ctx, "expense.write", "expense.approve", "finance.read");
  const e = await ctx.db.expense.findFirst({ where: { id } });
  if (!e) notFound();
  const mine = e.professionalId === ctx.professionalId;
  if (!mine && !ctx.permissions.has("expense.approve") && !ctx.permissions.has("finance.read")) notFound();
  const [cat, proj, pay] = await Promise.all([ctx.db.expenseCategory.findFirst({ where: { id: e.categoryId } }), e.projectId ? ctx.db.project.findFirst({ where: { id: e.projectId } }) : null, e.payableId ? ctx.db.payable.findFirst({ where: { id: e.payableId } }) : null]);
  return (
    <>
      <PageHeader title={`Despesa — ${e.description}`} subtitle={<StatusBadge status={e.status} />} breadcrumbs={[{ label: "Despesas", href: "/app/despesas" }, { label: formatCivil(e.date) }]}
        actions={(e.status === "DRAFT" || e.status === "REJECTED") && (mine || ctx.permissions.has("expense.approve")) && <ActionButton action={submitExpenseAction} fields={{ id }} variant="primary">Enviar para aprovação</ActionButton>} />
      {e.rejectionReason && <div className="mb-4"><Notice tone="error">Rejeitada: {e.rejectionReason}</Notice></div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Detalhes" className="lg:col-span-2">
          <DefinitionList items={[
            { label: "Data", value: formatCivil(e.date) }, { label: "Categoria", value: cat?.name }, { label: "Projeto", value: proj ? <Link className="text-brand-700 underline" href={`/app/projetos/${proj.id}`}>{proj.code} {proj.name}</Link> : "—" },
            { label: "Custo para a empresa", value: formatMoney(e.amount) }, { label: "Devido ao profissional", value: formatMoney(e.reimbursableToProfessional) }, { label: "Cobrável do cliente", value: formatMoney(e.billableAmount) },
            { label: "Pago por", value: e.paidBy === "PROFESSIONAL" ? "Profissional" : "Empresa" }, { label: "Faturamento", value: <StatusBadge status={e.billingStatus} /> },
            { label: "Reembolso (conta a pagar)", value: pay ? <Link className="text-brand-700 underline" href={`/app/financeiro/pagar/${pay.id}`}>{pay.number} — <StatusBadge status={pay.status} /></Link> : "—" },
          ]} />
        </Card>
        <div className="space-y-6">
          <ApprovalPanel ctx={ctx} entity="Expense" entityId={id} back={`/app/despesas/${id}`} />
          <Attachments ctx={ctx} entity="Expense" entityId={id} back={`/app/despesas/${id}`} canUpload={e.status === "DRAFT" || e.status === "REJECTED"} title="Comprovantes" allowClientVisibility />
        </div>
      </div>
    </>
  );
}
