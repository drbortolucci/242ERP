import { Card, Badge, StatusBadge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionButton, ActionForm, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import type { Ctx } from "@/server/context";
import { formatCivil, todayIn } from "@/lib/dates";
import { dec, formatMoney } from "@/lib/money";
import { cancelChargeAction, issueChargeAction, simulatePaymentAction } from "./banking-actions";

/** Cobranças bancárias (boleto/PIX) de um título a receber. */
export async function ChargesCard({ ctx, receivable }: { ctx: Ctx; receivable: { id: string; companyId: string; status: string; openAmount: unknown } }) {
  const [charges, banks] = await Promise.all([
    ctx.db.bankCharge.findMany({ where: { receivableId: receivable.id }, orderBy: { createdAt: "desc" } }),
    ctx.db.bankAccount.findMany({ where: { companyId: receivable.companyId, active: true } }),
  ]);
  const active = charges.find((c) => c.status === "REGISTERED" || c.status === "PENDING");
  const canIssue = ctx.permissions.has("finance.write") && ["OPEN", "PARTIAL"].includes(receivable.status) && !active && dec(receivable.openAmount as string).gt(0);
  return (
    <Card title="Cobrança bancária (boleto / PIX)">
      <DataTable dense rows={charges} empty="Nenhuma cobrança emitida." columns={[
        { key: "n", label: "Cobrança", render: (c) => <>{c.number} {c.environment === "SIMULATED" && <Badge tone="violet">simulada</Badge>}</> },
        { key: "m", label: "Meio", render: (c) => (c.method === "PIX" ? "PIX" : "Boleto") }, { key: "v", label: "Vencimento", render: (c) => formatCivil(c.dueDate) },
        { key: "a", label: "Valor", align: "right", render: (c) => formatMoney(c.amount) },
        { key: "p", label: "Pago", align: "right", render: (c) => (c.paidAmount ? `${formatMoney(c.paidAmount)} em ${formatCivil(c.paidAt)}` : "—") },
        { key: "s", label: "Situação", render: (c) => <StatusBadge status={c.status} /> },
        { key: "x", label: "", render: (c) => (
          <div className="flex flex-wrap gap-1">
            {c.status === "REGISTERED" && c.environment === "SIMULATED" && ctx.permissions.has("payment.register") && <ActionButton action={simulatePaymentAction} fields={{ id: c.id, receivableId: receivable.id }} confirm="Simular o aviso de pagamento do banco?">Simular pagamento</ActionButton>}
            {["REGISTERED", "PENDING", "ERROR"].includes(c.status) && ctx.permissions.has("finance.write") && <ActionButton action={cancelChargeAction} fields={{ id: c.id, receivableId: receivable.id, reason: "Baixa solicitada pelo financeiro" }} confirm="Cancelar (baixar) a cobrança no banco?">Cancelar</ActionButton>}
          </div>
        ) },
      ]} />
      {active && (
        <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="font-medium">{active.method === "PIX" ? "PIX copia e cola" : "Linha digitável"} — {active.number}</p>
          <code className="mt-1 block break-all text-xs">{active.method === "PIX" ? active.pixCode : active.digitableLine}</code>
          {active.paymentUrl && <a className="mt-1 block text-xs text-brand-700 underline" href={active.paymentUrl} target="_blank" rel="noreferrer">Abrir página de pagamento</a>}
          {active.environment === "SIMULATED" && <p className="mt-1 text-xs text-violet-700">Ambiente simulado: código de teste, não pagável. Nenhuma cobrança real foi registrada.</p>}
        </div>
      )}
      {charges.some((c) => c.lastError) && <p className="mt-2 text-xs text-amber-700">{charges.find((c) => c.lastError)?.lastError}</p>}
      {canIssue && (
        <ActionForm action={issueChargeAction} className="mt-4 border-t pt-4">
          <input type="hidden" name="receivableId" value={receivable.id} />
          <FormGrid cols={2}>
            <Select name="method" label="Meio" options={[{ value: "BOLETO", label: "Boleto registrado" }, { value: "PIX", label: "PIX com vencimento" }]} />
            <Select name="bankAccountId" label="Conta de recebimento" options={banks.map((b) => ({ value: b.id, label: b.name }))} required />
          </FormGrid>
          <FormGrid cols={2}>
            <Input name="finePct" label="Multa por atraso (%)" hint="Conforme contrato" />
            <Input name="interestPctMonth" label="Juros ao mês (%)" hint="Conforme contrato" />
          </FormGrid>
          <p className="mb-2 text-xs text-slate-500">Valor: saldo em aberto ({formatMoney(receivable.openAmount as string)}). Título vencido recebe novo vencimento em 3 dias (a partir de {formatCivil(todayIn(ctx.timezone))}).</p>
          <SubmitButton>Emitir cobrança</SubmitButton>
        </ActionForm>
      )}
    </Card>
  );
}
