import { notFound } from "next/navigation";
import { PageHeader, Card, DefinitionList, StatusBadge, Badge } from "@/components/ui/page";
import { ActionForm, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { portalScope } from "@/modules/portal/service";
import { getTicket, listComments } from "@/modules/ams/tickets";
import { formatInstant } from "@/lib/dates";
import { portalCommentAction, portalStatusAction, portalRateAction } from "../../actions";

export default async function PortalTicket({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  portalScope(ctx);
  const t = await getTicket(ctx, id).catch(() => null);
  if (!t) notFound();
  const comments = await listComments(ctx, id); // somente públicos para o cliente
  const tz = ctx.timezone;
  return (
    <>
      <PageHeader title={`${t.number} — ${t.title}`} subtitle={<span className="flex gap-2"><StatusBadge status={t.status} /><Badge>{t.priority}</Badge></span>} breadcrumbs={[{ label: "Chamados", href: "/portal/chamados" }, { label: t.number }]} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Descrição"><p className="whitespace-pre-wrap text-sm">{t.description}</p></Card>
          <Card title="Conversa">
            <ul className="space-y-3">{comments.map((c) => <li key={c.id} className="rounded border p-3 text-sm"><div className="mb-1 flex justify-between text-xs text-slate-500"><span>{c.authorName}</span><span>{formatInstant(c.createdAt, tz)}</span></div><p className="whitespace-pre-wrap">{c.body}</p></li>)}{comments.length === 0 && <li className="text-sm text-slate-500">Sem mensagens ainda.</li>}</ul>
            {!["CLOSED", "CANCELED"].includes(t.status) && <ActionForm action={portalCommentAction} resetOnSuccess className="mt-4 border-t pt-4"><input type="hidden" name="id" value={id} /><Textarea name="body" label="Mensagem" required /><SubmitButton variant="secondary">Enviar</SubmitButton></ActionForm>}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Prazos">
            <DefinitionList items={[{ label: "Aberto em", value: formatInstant(t.openedAt, tz) }, { label: "Primeira resposta", value: formatInstant(t.firstResponseAt, tz) }, { label: "Previsão de solução", value: formatInstant(t.resolutionDueAt, tz) }, { label: "Resolvido em", value: formatInstant(t.resolvedAt, tz) }]} />
          </Card>
          {t.status === "RESOLVED" && (
            <Card title="A solução atendeu?">
              <ActionForm action={portalStatusAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="to" value="CLOSED" /><SubmitButton>Sim, encerrar chamado</SubmitButton></ActionForm>
              <ActionForm action={portalStatusAction} className="mt-3"><input type="hidden" name="id" value={id} /><input type="hidden" name="to" value="IN_PROGRESS" /><Input name="note" label="Não — o que ainda ocorre?" required /><SubmitButton variant="secondary">Reabrir</SubmitButton></ActionForm>
            </Card>
          )}
          {t.status === "WAITING_CUSTOMER" && <Card title="Aguardando você"><ActionForm action={portalStatusAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="to" value="IN_PROGRESS" /><Input name="note" label="Resposta/informação solicitada" required /><SubmitButton>Responder e retomar</SubmitButton></ActionForm></Card>}
          {["RESOLVED", "CLOSED"].includes(t.status) && !t.csatScore && <Card title="Avalie o atendimento"><ActionForm action={portalRateAction}><input type="hidden" name="id" value={id} /><Select name="score" label="Nota" options={["5", "4", "3", "2", "1"].map((v) => ({ value: v, label: v }))} /><Input name="comment" label="Comentário" /><SubmitButton variant="secondary">Avaliar</SubmitButton></ActionForm></Card>}
        </div>
      </div>
    </>
  );
}
