import { PageHeader } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { pagePerm } from "@/server/page-guard";
import { requireCtx } from "@/server/auth/next";
import { pageQuery, sp, textSearch, type SearchParams } from "@/lib/query";
import { formatInstant } from "@/lib/dates";

export const metadata = { title: "Auditoria" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pagePerm(ctx, "audit.view");
  const q = pageQuery(s, 50);
  const entity = sp(s, "entidade");
  const where = { AND: [textSearch(q.q, ["action", "entity", "entityId", "actorLabel", "reason", "correlationId"]), entity ? { entity } : {}] };
  const [rows, total, entities] = await Promise.all([
    ctx.db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: q.skip, take: q.take }),
    ctx.db.auditLog.count({ where }),
    ctx.db.auditLog.groupBy({ by: ["entity"], orderBy: { entity: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Auditoria" subtitle="Operações críticas: aprovações, contratos, custos e tarifas, faturamento, liquidações, estornos, fechamentos, permissões, suporte e configurações." breadcrumbs={[{ label: "Administração" }, { label: "Auditoria" }]} />
      <Toolbar base="/app/admin/auditoria" params={s} exportHref="/api/export/auditoria" filters={[{ name: "entidade", label: "Entidade", options: entities.map((e) => ({ value: e.entity, label: e.entity })) }]} />
      <DataTable dense rows={rows} columns={[
        { key: "createdAt", label: "Data", render: (a) => formatInstant(a.createdAt, ctx.timezone) },
        { key: "actorLabel", label: "Usuário", render: (a) => a.actorLabel ?? "sistema" },
        { key: "action", label: "Ação", render: (a) => <code className="text-xs">{a.action}</code> },
        { key: "entity", label: "Registro", render: (a) => <span className="text-xs">{a.entity} {a.entityId?.slice(-8)}</span> },
        { key: "changes", label: "Alterações", render: (a) => a.changes ? <details><summary className="cursor-pointer text-xs text-brand-700">ver</summary><pre className="max-w-md whitespace-pre-wrap text-[11px]">{JSON.stringify(a.changes, null, 1)}</pre></details> : "—" },
        { key: "reason", label: "Justificativa", render: (a) => a.reason ?? "—" },
        { key: "correlationId", label: "Correlação", render: (a) => <span className="text-[10px] text-slate-500">{a.correlationId?.slice(0, 8) ?? "—"}</span> },
      ]} />
      <Pagination base="/app/admin/auditoria" params={s} page={q.page} pageSize={q.pageSize} total={total} />
    </>
  );
}
