import Link from "next/link";
import { PageHeader, Card, Grid, Stat, StatusBadge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { requireCtx } from "@/server/auth/next";
import { portalOverview } from "@/modules/portal/service";
import { formatCivil } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { statusLabel } from "@/lib/labels";

export const metadata = { title: "Portal do cliente" };
export default async function PortalHome() {
  const ctx = await requireCtx();
  const o = await portalOverview(ctx);
  const approver = ctx.permissions.has("portal.approve");
  return (
    <>
      <PageHeader title={`Olá, ${ctx.userName.split(" ")[0]}`} subtitle="Acompanhe seus contratos, chamados, aprovações e documentos" />
      <Grid cols={5}>
        <Stat label="Chamados abertos" value={o.openTickets} href="/portal/chamados" />
        {approver && <Stat label="Horas aguardando sua aprovação" value={o.timePending} href="/portal/aprovacoes" tone={o.timePending ? "warn" : "default"} />}
        {approver && <Stat label="Medições aguardando aprovação" value={o.measPending} href="/portal/aprovacoes" tone={o.measPending ? "warn" : "default"} />}
        {approver && <Stat label="Entregáveis para aceite" value={o.deliverables} href="/portal/projetos" tone={o.deliverables ? "warn" : "default"} />}
        <Stat label="Em aberto a pagar" value={formatMoney(o.openReceivables)} hint={o.overdue ? `${o.overdue} vencido(s)` : undefined} href="/portal/financeiro" tone={o.overdue ? "bad" : "default"} />
      </Grid>
      <Card title="Contratos" className="mt-6">
        <DataTable dense rows={o.contracts} columns={[{ key: "number", label: "Número" }, { key: "title", label: "Objeto" }, { key: "m", label: "Modelo", render: (c) => statusLabel(c.commercialModel) }, { key: "v", label: "Vigência", render: (c) => `${formatCivil(c.startDate)} a ${formatCivil(c.endDate)}` }, { key: "s", label: "Situação", render: (c) => <StatusBadge status={c.status} /> }]} />
      </Card>
      <p className="mt-4 text-sm"><Link className="text-brand-700 underline" href="/portal/chamados">Abrir um chamado</Link> · <Link className="text-brand-700 underline" href="/portal/conhecimento">Consultar a base de conhecimento</Link></p>
    </>
  );
}
