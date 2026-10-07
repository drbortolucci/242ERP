import { PageHeader, Card, Stat, Grid } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionForm, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { accountBalances } from "@/modules/finance/treasury";
import { formatCivil, todayIn } from "@/lib/dates";
import { formatMoney, sum } from "@/lib/money";
import { transferAction } from "../actions";

const KIND: Record<string, string> = { SETTLEMENT: "Liquidação", TRANSFER: "Transferência", ADVANCE: "Adiantamento", FEE: "Tarifa", MANUAL: "Manual", REVERSAL: "Estorno" };

export const metadata = { title: "Tesouraria" };
export default async function TreasuryPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "finance.read");
  const [balances, txs] = await Promise.all([accountBalances(ctx), ctx.db.bankTransaction.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 40 })]);
  const accName = new Map(balances.map((b) => [b.account.id, b.account.name]));
  return (
    <>
      <PageHeader title="Tesouraria" breadcrumbs={[{ label: "Financeiro" }, { label: "Tesouraria" }]} />
      <Grid cols={4}>
        <Stat label="Saldo consolidado (livro)" value={formatMoney(sum(balances.map((b) => b.balance)))} />
        {balances.map((b) => <Stat key={b.account.id} label={b.account.name} value={formatMoney(b.balance)} hint={b.pendingLines ? `${b.pendingLines} linha(s) de extrato a conciliar` : "extrato conciliado"} tone={b.pendingLines ? "warn" : "default"} href="/app/financeiro/conciliacao" />)}
      </Grid>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Últimos movimentos" className="xl:col-span-2">
          <DataTable dense rows={txs} columns={[{ key: "d", label: "Data", render: (t) => formatCivil(t.date) }, { key: "c", label: "Conta", render: (t) => accName.get(t.bankAccountId) }, { key: "k", label: "Tipo", render: (t) => KIND[t.kind] ?? t.kind }, { key: "description", label: "Descrição" }, { key: "a", label: "Valor", align: "right", render: (t) => <span className={Number(t.amount) < 0 ? "text-red-700" : "text-emerald-700"}>{formatMoney(t.amount)}</span> }, { key: "r", label: "Conciliado", render: (t) => (t.reconciledAt ? "sim" : "—") }]} />
        </Card>
        {ctx.permissions.has("treasury.manage") && (
          <Card title="Transferência entre contas">
            <ActionForm action={transferAction} resetOnSuccess>
              <Select name="fromAccountId" label="De" options={balances.map((b) => ({ value: b.account.id, label: b.account.name }))} required />
              <Select name="toAccountId" label="Para" options={balances.map((b) => ({ value: b.account.id, label: b.account.name }))} required />
              <FormGrid cols={2}><Input name="amount" label="Valor" required /><Input name="date" type="date" label="Data" defaultValue={todayIn(ctx.timezone)} required /></FormGrid>
              <Input name="description" label="Descrição" />
              <SubmitButton>Transferir</SubmitButton>
              <p className="text-xs text-slate-500">Somente entre contas da mesma empresa. Nenhuma ordem é enviada ao banco: o registro é interno.</p>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
