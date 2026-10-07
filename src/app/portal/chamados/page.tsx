import { PageHeader, Card, StatusBadge, Badge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionForm, FormGrid, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { portalScope } from "@/modules/portal/service";
import { formatInstant } from "@/lib/dates";
import { portalOpenTicketAction } from "../actions";

const LEVELS = [{ value: "1", label: "Alto" }, { value: "2", label: "Médio" }, { value: "3", label: "Baixo" }];
export const metadata = { title: "Chamados" };
export default async function PortalTickets() {
  const ctx = await requireCtx();
  const partyId = portalScope(ctx);
  const rows = await ctx.db.ticket.findMany({ where: { partyId }, orderBy: { openedAt: "desc" }, take: 100, select: { id: true, number: true, title: true, priority: true, status: true, openedAt: true, resolutionDueAt: true, openedByContactName: true } });
  return (
    <>
      <PageHeader title="Chamados" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DataTable rows={rows} rowHref={(r) => `/portal/chamados/${r.id}`} empty="Nenhum chamado." columns={[{ key: "number", label: "Número" }, { key: "title", label: "Título" }, { key: "p", label: "Prioridade", render: (r) => <Badge>{r.priority}</Badge> }, { key: "o", label: "Aberto em", render: (r) => formatInstant(r.openedAt, ctx.timezone) }, { key: "d", label: "Previsão de solução", render: (r) => formatInstant(r.resolutionDueAt, ctx.timezone) }, { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> }]} />
        </div>
        <Card title="Abrir chamado">
          <ActionForm action={portalOpenTicketAction}>
            <Select name="type" label="Tipo" options={[{ value: "INCIDENT", label: "Problema/erro" }, { value: "REQUEST", label: "Solicitação" }, { value: "CHANGE", label: "Mudança/melhoria" }]} />
            <FormGrid cols={2}><Input name="system" label="Sistema" /><Input name="module" label="Módulo" /></FormGrid>
            <Input name="title" label="Título" required />
            <Textarea name="description" label="Descreva o que aconteceu" required />
            <FormGrid cols={2}><Select name="impact" label="Impacto no negócio" options={LEVELS} defaultValue="3" /><Select name="urgency" label="Urgência" options={LEVELS} defaultValue="3" /></FormGrid>
            <SubmitButton>Abrir chamado</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
