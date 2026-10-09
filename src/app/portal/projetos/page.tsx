import { PageHeader, Card, StatusBadge, Badge } from "@/components/ui/page";
import { getTerms } from "@/modules/sectors/service";
import { DataTable } from "@/components/ui/table";
import { ActionForm, Input, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { portalProjects } from "@/modules/portal/service";
import { formatCivil } from "@/lib/dates";
import { portalDeliverableAction } from "../actions";

const KIND: Record<string, string> = { RISK: "Risco", ISSUE: "Problema", DECISION: "Decisão", PENDING: "Pendência", CHANGE: "Mudança" };
const RAG: Record<string, "green" | "amber" | "red"> = { GREEN: "green", YELLOW: "amber", RED: "red" };
export const metadata = { title: "Projetos" };
export default async function PortalProjects() {
  const ctx = await requireCtx();
  const terms = await getTerms(ctx);
  const projects = await portalProjects(ctx);
  const approver = ctx.permissions.has("portal.approve");
  return (
    <>
      <PageHeader title={terms.projects} />
      {projects.length === 0 && <p className="text-sm text-slate-500">Nenhum projeto.</p>}
      <div className="space-y-6">{projects.map((p) => (
        <Card key={p.id} title={<span>{p.code} {p.name} <StatusBadge status={p.status} /></span>}>
          <p className="text-sm text-slate-600">Planejado: {formatCivil(p.plannedStart)} a {formatCivil(p.plannedEnd)} · Avanço físico (entregas concluídas): {p.progressPct ? `${p.progressPct.toFixed(0)}%` : "—"}</p>
          {p.reports[0] && <div className="mt-3 rounded border p-3 text-sm"><p className="mb-1 font-medium">Último status ({formatCivil(p.reports[0].createdAt)}) <Badge tone={RAG[p.reports[0].overall]}>geral</Badge> <Badge tone={RAG[p.reports[0].schedule]}>prazo</Badge> <Badge tone={RAG[p.reports[0].scope]}>escopo</Badge></p><p>{p.reports[0].summary}</p>{p.reports[0].nextSteps && <p className="mt-1 text-slate-600">Próximos passos: {p.reports[0].nextSteps}</p>}</div>}
          <h3 className="mt-4 text-sm font-semibold">Entregáveis</h3>
          <DataTable dense rows={p.deliverables} empty="Sem entregáveis com aceite formal." columns={[{ key: "name", label: "Entregável" }, { key: "d", label: "Previsto", render: (d) => formatCivil(d.plannedEnd) }, { key: "s", label: "Situação", render: (d) => d.acceptanceStatus === "ACCEPTED" ? <Badge tone="green">aceito por {d.acceptedByName}</Badge> : d.acceptanceStatus === "REJECTED" ? <Badge tone="red">recusado</Badge> : d.status === "DONE" ? <Badge tone="amber">aguardando aceite</Badge> : <StatusBadge status={d.status} /> },
            { key: "a", label: "", render: (d) => approver && d.status === "DONE" && d.acceptanceStatus !== "ACCEPTED" ? <span className="flex flex-wrap gap-2"><ActionForm action={portalDeliverableAction}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="decision" value="approve" /><SubmitButton>Aceitar</SubmitButton></ActionForm><ActionForm action={portalDeliverableAction} className="flex items-end gap-1"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="decision" value="reject" /><Input name="comment" aria-label="Motivo" placeholder="Motivo" required /><SubmitButton variant="danger">Recusar</SubmitButton></ActionForm></span> : null }]} />
          {p.logs.length > 0 && <><h3 className="mt-4 text-sm font-semibold">Riscos, decisões e pendências</h3><DataTable dense rows={p.logs} columns={[{ key: "k", label: "Tipo", render: (l) => KIND[l.kind] ?? l.kind }, { key: "title", label: "Descrição" }, { key: "o", label: "Responsável", render: (l) => l.ownerName ?? "—" }, { key: "s", label: "Situação", render: (l) => <StatusBadge status={l.status} /> }]} /></>}
        </Card>
      ))}</div>
    </>
  );
}
