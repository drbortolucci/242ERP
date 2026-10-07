import { PageHeader, Card } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionForm, FormGrid, Input, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { nameMap } from "@/modules/config/lookups";
import { formatCivil } from "@/lib/dates";
import { formatQty, formatMoney, dec } from "@/lib/money";
import { approveEntriesAction, adjustmentAction } from "../actions";

export const metadata = { title: "Aprovação de horas" };
export default async function ApprovalPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "time.approve");
  const [pending, clientPending, invoiced] = await Promise.all([
    ctx.db.timeEntry.findMany({ where: { status: "SUBMITTED" }, orderBy: [{ professionalId: "asc" }, { date: "asc" }], take: 300 }),
    ctx.db.timeEntry.findMany({ where: { status: "APPROVED", clientApproval: "PENDING" }, orderBy: { date: "asc" }, take: 300 }),
    ctx.db.timeEntry.findMany({ where: { billingStatus: { in: ["INVOICED", "MEASURED"] }, adjustsEntryId: null }, orderBy: { date: "desc" }, take: 30 }),
  ]);
  const all = [...pending, ...clientPending, ...invoiced];
  const [profs, projs] = await Promise.all([nameMap(ctx, "professional", all.map((e) => e.professionalId)), nameMap(ctx, "project", all.map((e) => e.projectId))]);
  const cols = [
    { key: "p", label: "Profissional", render: (e: (typeof all)[number]) => profs.get(e.professionalId) },
    { key: "d", label: "Data", render: (e: (typeof all)[number]) => formatCivil(e.date) },
    { key: "pr", label: "Projeto", render: (e: (typeof all)[number]) => projs.get(e.projectId ?? "") ?? (e.ticketId ? "Chamado" : e.internalCode ?? "—") },
    { key: "desc", label: "Descrição", render: (e: (typeof all)[number]) => e.description },
    { key: "h", label: "Horas", align: "right" as const, render: (e: (typeof all)[number]) => `${formatQty(e.hours)}${e.overtime ? " (extra)" : ""}` },
    { key: "b", label: "Fat.", render: (e: (typeof all)[number]) => (e.billable ? "Sim" : "Não") },
  ];
  return (
    <>
      <PageHeader title="Aprovação de horas" subtitle="Aprovação operacional (interna) é separada da elegibilidade comercial (aprovação do cliente, quando exigida pelo contrato)." breadcrumbs={[{ label: "Horas", href: "/app/horas" }, { label: "Aprovação" }]} />
      <div className="space-y-6">
        <Card title={`Aguardando aprovação interna (${pending.length})`}>
          <ActionForm action={approveEntriesAction} noImplicitSubmit>
            <DataTable dense rows={pending} columns={[{ key: "sel", label: "", render: (e) => <input type="checkbox" name="ids[]" value={e.id} defaultChecked aria-label="Selecionar" /> }, ...cols]} empty={<p className="text-sm text-slate-500">Nada pendente.</p>} />
            {pending.length > 0 && <div className="flex flex-wrap items-end gap-2"><SubmitButton name="decision" value="approve">Aprovar selecionados</SubmitButton><Input name="reason" placeholder="Motivo da rejeição" aria-label="Motivo" /><SubmitButton name="decision" value="reject" variant="danger">Rejeitar selecionados</SubmitButton></div>}
          </ActionForm>
        </Card>
        <Card title={`Aguardando aprovação do cliente (${clientPending.length})`}>
          <p className="mb-2 text-xs text-slate-600">O cliente aprova no portal. Se a aprovação ocorreu por outro meio (e-mail, ata), registre aqui com o nome do aprovador — fica auditado.</p>
          <ActionForm action={approveEntriesAction}>
            <DataTable dense rows={clientPending} columns={[{ key: "sel", label: "", render: (e) => <input type="checkbox" name="ids[]" value={e.id} aria-label="Selecionar" /> }, ...cols, { key: "v", label: "Valor", align: "right", render: (e) => formatMoney(dec(e.hours).times(dec(e.sellRate ?? 0))) }]} empty={<p className="text-sm text-slate-500">Nada pendente.</p>} />
            {clientPending.length > 0 && <div className="flex items-end gap-2"><Input name="byName" placeholder="Aprovado por (nome no cliente)" aria-label="Aprovado por" /><SubmitButton name="decision" value="client" variant="secondary">Registrar aprovação do cliente</SubmitButton></div>}
          </ActionForm>
        </Card>
        <Card title="Correção de horas já medidas/faturadas (ajuste rastreável)">
          <DataTable dense rows={invoiced} columns={[...cols, { key: "adj", label: "Ajuste", render: (e) => (
            <ActionForm action={adjustmentAction} className="space-y-1"><input type="hidden" name="id" value={e.id} /><FormGrid cols={2}><Input name="delta" placeholder="Δ horas (ex.: -1,5)" aria-label="Diferença de horas" /><Input name="reason" placeholder="Motivo" aria-label="Motivo" /></FormGrid><SubmitButton variant="secondary">Criar ajuste</SubmitButton></ActionForm>
          ) }]} empty={<p className="text-sm text-slate-500">Nenhum apontamento faturado recente.</p>} />
        </Card>
      </div>
    </>
  );
}
