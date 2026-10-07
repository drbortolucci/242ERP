import { PageHeader, Card, StatusBadge, Stat, Grid } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { ActionForm, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import type { Ctx } from "@/server/context";
import { lookups, nameMap } from "@/modules/config/lookups";
import { aging } from "@/modules/finance/service";
import { pageQuery, sp, textSearch, type SearchParams } from "@/lib/query";
import { formatCivil, todayIn, toCivil } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { statusLabel } from "@/lib/labels";
import { manualTitleAction, recurringAction } from "./actions";

const BUCKET: Record<string, string> = { A_VENCER: "A vencer", "1_30": "Vencido 1–30", "31_60": "31–60", "61_90": "61–90", "90_MAIS": "> 90 dias" };
const SOURCE: Record<string, string> = { SUPPLIER_INVOICE: "Fornecedor", EXPENSE_REIMBURSEMENT: "Reembolso", EXPENSE_ADVANCE: "Adiant. despesa", RECURRING: "Recorrente", SUPPLIER_ADVANCE: "Adiant. fornecedor", MANUAL: "Manual", PAYROLL: "Folha" };

export async function TitlesList({ ctx, kind, s }: { ctx: Ctx; kind: "RECEIVABLE" | "PAYABLE"; s: SearchParams }) {
  const q = pageQuery(s);
  const status = sp(s, "status") ?? "ABERTOS";
  const today = todayIn(ctx.timezone);
  const statusWhere = status === "ABERTOS" ? { status: { in: kind === "PAYABLE" ? ["PENDING_APPROVAL", "OPEN", "PARTIAL"] : ["OPEN", "PARTIAL"] } } : status === "TODOS" ? {} : { status };
  const where = { AND: [textSearch(q.q, ["number", "description"]), statusWhere] };
  const [raw, total, ag, companies, parties, accounts, ccs] = await Promise.all([
    kind === "RECEIVABLE" ? ctx.db.receivable.findMany({ where, orderBy: { dueDate: "asc" }, skip: q.skip, take: q.take }) : ctx.db.payable.findMany({ where, orderBy: { dueDate: "asc" }, skip: q.skip, take: q.take }),
    kind === "RECEIVABLE" ? ctx.db.receivable.count({ where }) : ctx.db.payable.count({ where }),
    aging(ctx, kind, today), lookups.companies(ctx), kind === "RECEIVABLE" ? lookups.customers(ctx) : lookups.suppliers(ctx), lookups.accounts(ctx), lookups.costCenters(ctx),
  ]);
  type Row = { id: string; number: string; partyId: string | null; description: string | null; dueDate: Date; amount: unknown; openAmount: unknown; status: string; sourceType?: string };
  const rows = (raw as Row[]).map((r) => ({ id: r.id, number: r.number, partyId: r.partyId, description: r.description, dueDate: r.dueDate, amount: r.amount as string, openAmount: r.openAmount as string, status: r.status, sourceType: r.sourceType }));
  const pn = await nameMap(ctx, "party", rows.map((r) => r.partyId));
  const base = kind === "RECEIVABLE" ? "/app/financeiro/receber" : "/app/financeiro/pagar";
  const slug = kind === "RECEIVABLE" ? "receber" : "pagar";
  const pendingApproval = kind === "PAYABLE" ? await ctx.db.payable.count({ where: { status: "PENDING_APPROVAL" } }) : 0;
  return (
    <>
      <PageHeader title={kind === "RECEIVABLE" ? "Contas a receber" : "Contas a pagar"} breadcrumbs={[{ label: "Financeiro" }, { label: kind === "RECEIVABLE" ? "Receber" : "Pagar" }]} />
      <Grid cols={6}>
        <Stat label="Em aberto" value={formatMoney(ag.total)} hint={`${ag.count} título(s)`} />
        {Object.entries(ag.buckets).map(([k, v]) => <Stat key={k} label={BUCKET[k]} value={formatMoney(v)} tone={k === "A_VENCER" ? "default" : v.gt(0) ? "bad" : "default"} />)}
      </Grid>
      {pendingApproval > 0 && <p className="mt-3 text-sm text-amber-800">{pendingApproval} conta(s) a pagar aguardando aprovação financeira.</p>}
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Toolbar base={base} params={s} filters={[{ name: "status", label: "Situação", options: [{ value: "ABERTOS", label: "Em aberto" }, { value: "TODOS", label: "Todos" }, ...[...(kind === "PAYABLE" ? ["PENDING_APPROVAL"] : []), "OPEN", "PARTIAL", "PAID", "CANCELED"].map((v) => ({ value: v, label: statusLabel(v) }))] }]} />
          <DataTable rows={rows} rowHref={(r) => `/app/financeiro/titulos/${slug}/${r.id}`} columns={[
            { key: "number", label: "Número" }, { key: "p", label: kind === "RECEIVABLE" ? "Cliente" : "Fornecedor", render: (r) => pn.get(r.partyId ?? "") ?? "—" },
            { key: "d", label: "Descrição", render: (r) => <>{r.description}{r.sourceType && <div className="text-xs text-slate-500">{SOURCE[r.sourceType] ?? r.sourceType}</div>}</> },
            { key: "v", label: "Vencimento", render: (r) => <span className={["OPEN", "PARTIAL"].includes(r.status) && toCivil(r.dueDate) < today ? "text-red-700" : ""}>{formatCivil(r.dueDate)}</span> },
            { key: "a", label: "Valor", align: "right", render: (r) => formatMoney(r.amount) }, { key: "o", label: "Em aberto", align: "right", render: (r) => formatMoney(r.openAmount) },
            { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> },
          ]} />
          <Pagination base={base} params={s} page={q.page} pageSize={q.pageSize} total={total} />
        </div>
        {ctx.permissions.has("finance.write") && (
          <div className="space-y-6">
            <Card title={kind === "RECEIVABLE" ? "Título a receber avulso" : "Título a pagar avulso"}>
              <ActionForm action={manualTitleAction}>
                <input type="hidden" name="kind" value={kind} />
                <Select name="companyId" label="Empresa" options={companies} required />
                <Select name="partyId" label={kind === "RECEIVABLE" ? "Cliente" : "Fornecedor"} options={parties} placeholder="—" />
                <Input name="description" label="Descrição" required />
                <FormGrid cols={2}><Input name="amount" label="Valor" required /><Input name="dueDate" type="date" label="Vencimento" required /></FormGrid>
                <FormGrid cols={2}><Input name="issueDate" type="date" label="Emissão" defaultValue={today} required /><Input name="competence" type="date" label="Competência" defaultValue={today} required /></FormGrid>
                <FormGrid cols={2}><Select name="accountId" label="Conta gerencial" options={accounts} placeholder="—" />{kind === "PAYABLE" ? <Select name="costCenterId" label="Centro de custo" options={ccs} placeholder="—" /> : <span />}</FormGrid>
                <SubmitButton>Registrar</SubmitButton>
              </ActionForm>
            </Card>
            {kind === "PAYABLE" && (
              <Card title="Conta recorrente (aluguel, assinaturas…)">
                <ActionForm action={recurringAction}>
                  <Select name="companyId" label="Empresa" options={companies} required />
                  <Select name="partyId" label="Fornecedor" options={parties} placeholder="—" />
                  <Input name="description" label="Descrição" required />
                  <FormGrid cols={2}><Input name="amount" label="Valor mensal" required /><Input name="dayOfMonth" type="number" label="Dia do vencimento" defaultValue="10" /></FormGrid>
                  <FormGrid cols={2}><Input name="startDate" type="date" label="Início" defaultValue={today} required /><Input name="endDate" type="date" label="Fim" /></FormGrid>
                  <FormGrid cols={2}><Select name="accountId" label="Conta gerencial" options={accounts} placeholder="—" /><Select name="costCenterId" label="Centro de custo" options={ccs} placeholder="—" /></FormGrid>
                  <SubmitButton variant="secondary">Criar recorrência</SubmitButton>
                </ActionForm>
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  );
}
