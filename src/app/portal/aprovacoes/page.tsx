import { PageHeader, Card, Notice, StatusBadge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionForm, Input, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { portalPendingTime, portalMeasurements } from "@/modules/portal/service";
import { formatCivil } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { portalTimeDecisionAction, portalMeasurementAction } from "../actions";

export const metadata = { title: "Aprovações" };
export default async function PortalApprovals() {
  const ctx = await requireCtx();
  if (!ctx.permissions.has("portal.approve")) return <><PageHeader title="Aprovações" /><Notice tone="info">Seu perfil não aprova horas ou medições. Fale com o responsável no seu time.</Notice></>;
  const [time, ms] = await Promise.all([portalPendingTime(ctx), portalMeasurements(ctx)]);
  const pendingMs = ms.filter((m) => m.status === "CLIENT_PENDING");
  return (
    <>
      <PageHeader title="Aprovações" />
      <Card title={`Horas aguardando aprovação (${time.length})`}>
        {time.length === 0 ? <p className="text-sm text-slate-500">Nada pendente.</p> : (
          <ActionForm action={portalTimeDecisionAction} noImplicitSubmit>
            <table className="min-w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="p-1" /><th className="p-1">Data</th><th className="p-1">Profissional</th><th className="p-1">Atividade</th><th className="p-1 text-right">Horas</th><th className="p-1 text-right">Valor</th></tr></thead>
              <tbody>{time.map((t) => <tr key={t.id} className="border-t"><td className="p-1"><input type="checkbox" name="ids[]" value={t.id} defaultChecked aria-label={`Selecionar ${t.description}`} /></td><td className="p-1">{formatCivil(t.date)}</td><td className="p-1">{t.professional}</td><td className="p-1">{t.description}</td><td className="p-1 text-right">{formatQty(t.hours)}</td><td className="p-1 text-right">{t.amount ? formatMoney(t.amount) : "—"}</td></tr>)}</tbody>
            </table>
            <div className="flex flex-wrap items-end gap-2"><SubmitButton name="decision" value="approve">Aprovar selecionadas</SubmitButton><Input name="reason" label="Motivo (para recusa)" /><SubmitButton name="decision" value="reject" variant="danger">Recusar selecionadas</SubmitButton></div>
          </ActionForm>
        )}
      </Card>
      <Card title={`Medições aguardando aprovação (${pendingMs.length})`} className="mt-6">
        {pendingMs.length === 0 && <p className="text-sm text-slate-500">Nada pendente.</p>}
        {pendingMs.map((m) => (
          <div key={m.id} className="mb-4 rounded border p-3">
            <p className="text-sm font-medium">{m.number} — período {formatCivil(m.periodStart)} a {formatCivil(m.periodEnd)} — {formatMoney(m.totalAmount)}</p>
            <DataTable dense rows={m.items.map((i, k) => ({ ...i, id: String(k) }))} columns={[{ key: "description", label: "Item" }, { key: "q", label: "Qtd.", align: "right", render: (i) => formatQty(i.quantity) }, { key: "u", label: "Unitário", align: "right", render: (i) => formatMoney(i.unitPrice) }, { key: "a", label: "Valor", align: "right", render: (i) => formatMoney(i.amount) }]} />
            <div className="mt-2 flex flex-wrap gap-3">
              <ActionForm action={portalMeasurementAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="decision" value="approve" /><SubmitButton>Aprovar medição</SubmitButton></ActionForm>
              <ActionForm action={portalMeasurementAction} className="flex items-end gap-2"><input type="hidden" name="id" value={m.id} /><input type="hidden" name="decision" value="reject" /><Input name="reason" label="Motivo da recusa" required /><SubmitButton variant="danger">Recusar</SubmitButton></ActionForm>
            </div>
          </div>
        ))}
      </Card>
      <Card title="Histórico de medições" className="mt-6">
        <DataTable dense rows={ms.filter((m) => m.status !== "CLIENT_PENDING")} columns={[{ key: "number", label: "Medição" }, { key: "p", label: "Competência", render: (m) => formatCivil(m.competence).slice(3) }, { key: "t", label: "Total", align: "right", render: (m) => formatMoney(m.totalAmount) }, { key: "a", label: "Aprovada por", render: (m) => m.clientApprovedByName ?? "—" }, { key: "s", label: "Situação", render: (m) => <StatusBadge status={m.status} /> }]} />
      </Card>
    </>
  );
}
