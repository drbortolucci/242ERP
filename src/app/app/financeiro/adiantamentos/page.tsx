import { PageHeader, Card, StatusBadge, Badge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionForm, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { lookups, nameMap } from "@/modules/config/lookups";
import { formatCivil, todayIn } from "@/lib/dates";
import { dec, formatMoney } from "@/lib/money";
import { advanceAction } from "../actions";

export const metadata = { title: "Adiantamentos" };
export default async function AdvancesPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "finance.read");
  const [rows, companies, customers, suppliers, banks] = await Promise.all([ctx.db.advance.findMany({ orderBy: { date: "desc" }, take: 100 }), lookups.companies(ctx), lookups.customers(ctx), lookups.suppliers(ctx), lookups.bankAccounts(ctx)]);
  const pn = await nameMap(ctx, "party", rows.map((r) => r.partyId));
  return (
    <>
      <PageHeader title="Adiantamentos de clientes e a fornecedores" breadcrumbs={[{ label: "Financeiro" }, { label: "Adiantamentos" }]} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <DataTable rows={rows} columns={[
            { key: "d", label: "Data", render: (a) => formatCivil(a.date) }, { key: "dir", label: "Tipo", render: (a) => <Badge tone={a.direction === "CUSTOMER" ? "green" : "amber"}>{a.direction === "CUSTOMER" ? "De cliente" : "A fornecedor"}</Badge> },
            { key: "p", label: "Parte", render: (a) => pn.get(a.partyId) }, { key: "desc", label: "Descrição", render: (a) => a.description ?? "" },
            { key: "a", label: "Valor", align: "right", render: (a) => formatMoney(a.amount) }, { key: "ap", label: "Aplicado", align: "right", render: (a) => formatMoney(a.appliedAmount) },
            { key: "s", label: "Saldo", align: "right", render: (a) => formatMoney(dec(a.amount).minus(a.appliedAmount)) }, { key: "st", label: "Situação", render: (a) => <StatusBadge status={a.status} /> },
          ]} />
          <p className="mt-2 text-xs text-slate-500">O saldo é aplicado na tela do título (a receber ou a pagar) da mesma parte. Adiantamentos de pedidos de compra são gerados ao pagar o título de adiantamento.</p>
        </div>
        {ctx.permissions.has("payment.register") && (
          <Card title="Registrar adiantamento">
            <ActionForm action={advanceAction}>
              <Select name="direction" label="Tipo" options={[{ value: "CUSTOMER", label: "Recebido de cliente" }, { value: "SUPPLIER", label: "Pago a fornecedor" }]} />
              <Select name="companyId" label="Empresa" options={companies} required />
              <Select name="partyId" label="Cliente/fornecedor" options={[...customers, ...suppliers]} required />
              <FormGrid cols={2}><Input name="amount" label="Valor" required /><Input name="date" type="date" label="Data" defaultValue={todayIn(ctx.timezone)} required /></FormGrid>
              <Select name="bankAccountId" label="Conta bancária" options={banks} required />
              <Input name="description" label="Descrição" />
              <SubmitButton>Registrar</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
