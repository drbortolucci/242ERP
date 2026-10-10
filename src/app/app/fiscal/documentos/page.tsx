import Link from "@/components/ui/access-link";
import { PageHeader, StatusBadge, Badge, Notice, Grid, Stat } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { ActionButton, ActionForm, Input, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { fiscalSummary } from "@/modules/fiscal/service";
import { externalActionsAllowed } from "@/server/providers/env";
import { pageQuery, sp, textSearch, type SearchParams } from "@/lib/query";
import { formatInstant } from "@/lib/dates";
import { statusLabel } from "@/lib/labels";
import { cancelFiscalAction, retryFiscalAction } from "../actions";

export const metadata = { title: "Documentos fiscais" };
export default async function FiscalDocumentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pagePerm(ctx, "fiscal.read");
  const q = pageQuery(s);
  const status = sp(s, "status");
  const docType = sp(s, "tipo");
  const where = { AND: [textSearch(q.q, ["number", "externalId"]), status ? { status } : {}, docType ? { docType } : {}] };
  const [rows, total, summary] = await Promise.all([ctx.db.fiscalDocument.findMany({ where, orderBy: { createdAt: "desc" }, skip: q.skip, take: q.take }), ctx.db.fiscalDocument.count({ where }), fiscalSummary(ctx)]);
  const [bds, pos] = await Promise.all([
    ctx.db.billingDocument.findMany({ where: { id: { in: rows.map((r) => r.billingDocumentId).filter((x): x is string => !!x) } }, select: { id: true, number: true } }),
    ctx.db.productOrder.findMany({ where: { id: { in: rows.map((r) => r.productOrderId).filter((x): x is string => !!x) } }, select: { id: true, number: true } }),
  ]);
  const count = (st: string) => summary.filter((x) => x.status === st).reduce((a, b) => a + b.count, 0);
  const canIssue = ctx.permissions.has("fiscal.issue");
  return (
    <>
      <PageHeader title="Documentos fiscais" subtitle="NFS-e de serviços e NF-e de mercadorias emitidas pelo provedor configurado" breadcrumbs={[{ label: "Fiscal" }, { label: "Documentos" }]} />
      {!externalActionsAllowed() && <div className="mb-4"><Notice>Ambiente simulado: nenhum documento fiscal real é emitido; números e chaves são fictícios (prefixo SIM).</Notice></div>}
      <Grid cols={4}>
        <Stat label="Autorizados" value={count("AUTHORIZED")} href="/app/fiscal/documentos?status=AUTHORIZED" tone="good" />
        <Stat label="Rejeitados ou com erro" value={count("REJECTED") + count("ERROR")} href="/app/fiscal/documentos?status=REJECTED" tone={count("REJECTED") + count("ERROR") ? "bad" : "default"} />
        <Stat label="Em processamento" value={count("PENDING") + count("PROCESSING")} href="/app/fiscal/documentos?status=PENDING" tone={count("PENDING") + count("PROCESSING") ? "warn" : "default"} />
        <Stat label="Cancelados" value={count("CANCELED")} href="/app/fiscal/documentos?status=CANCELED" />
      </Grid>
      <div className="mt-6">
        <Toolbar base="/app/fiscal/documentos" params={s} filters={[{ name: "tipo", label: "Tipo", options: [{ value: "NFSE", label: "NFS-e (serviços)" }, { value: "NFE", label: "NF-e (mercadorias)" }] }, { name: "status", label: "Situação", options: ["AUTHORIZED", "REJECTED", "ERROR", "PENDING", "PROCESSING", "CANCELED"].map((v) => ({ value: v, label: statusLabel(v) })) }]} />
        <DataTable rows={rows} empty="Nenhum documento fiscal." columns={[
          { key: "t", label: "Tipo", render: (r) => <>{r.docType === "NFE" ? "NF-e" : "NFS-e"} {r.environment === "SIMULATED" && <Badge tone="violet">simulado</Badge>}</> },
          { key: "o", label: "Origem", render: (r) => r.productOrderId ? <Link className="text-brand-700 hover:underline" href={`/app/estoque/vendas/${r.productOrderId}`}>{pos.find((p) => p.id === r.productOrderId)?.number ?? "Pedido"}</Link> : r.billingDocumentId ? <Link className="text-brand-700 hover:underline" href={`/app/faturamento/cobrancas/${r.billingDocumentId}`}>{bds.find((b) => b.id === r.billingDocumentId)?.number ?? "Cobrança"}</Link> : "—" },
          { key: "n", label: "Número", render: (r) => r.number ?? "—" }, { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> },
          { key: "a", label: "Autorização", render: (r) => (r.authorizedAt ? formatInstant(r.authorizedAt, ctx.timezone) : "—") },
          { key: "m", label: "Mensagem", render: (r) => <span className="text-xs">{r.cancelReason ? `Cancelado: ${r.cancelReason}` : r.lastError ?? "—"}</span> },
          { key: "x", label: "", render: (r) => canIssue ? (
            r.status === "AUTHORIZED" ? <ActionForm action={cancelFiscalAction} className="flex items-end gap-1"><input type="hidden" name="id" value={r.id} /><Input name="reason" aria-label="Justificativa do cancelamento" placeholder="Justificativa (mín. 15)" required /><SubmitButton variant="danger" confirm="Cancelar o documento fiscal no provedor?">Cancelar</SubmitButton></ActionForm>
            : ["REJECTED", "ERROR", "PENDING"].includes(r.status) ? <ActionButton action={retryFiscalAction} fields={{ id: r.id }}>Reprocessar</ActionButton> : null
          ) : null },
        ]} />
        <Pagination base="/app/fiscal/documentos" params={s} page={q.page} pageSize={q.pageSize} total={total} />
      </div>
    </>
  );
}
