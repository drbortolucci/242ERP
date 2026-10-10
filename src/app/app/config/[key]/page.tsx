import { notFound } from "next/navigation";
import Link from "@/components/ui/access-link";
import { PageHeader, Card, StatusBadge } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { ActionButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { getConfigEntity } from "@/modules/config/registry";
import { listConfig, lookupOptions } from "@/modules/config/service";
import { pageQuery, type SearchParams } from "@/lib/query";
import { formatCivil } from "@/lib/dates";
import { ConfigForm } from "../config-form";
import { toggleConfigAction } from "../actions";

export default async function ConfigListPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<SearchParams> }) {
  const { key } = await params;
  const sp = await searchParams;
  const e = getConfigEntity(key);
  if (!e) notFound();
  const ctx = await requireCtx();
  pagePerm(ctx, "settings.manage");
  const q = pageQuery(sp);
  const { rows, total, labels } = await listConfig(ctx, key, q);
  const lookups: Record<string, { value: string; label: string }[]> = {};
  for (const f of e.fields.filter((x) => x.type === "lookup")) lookups[f.name] = await lookupOptions(ctx, f);
  const cols = e.fields.filter((f) => f.list).map((f) => ({
    key: f.name, label: f.label,
    render: (r: Record<string, unknown>) => {
      const v = r[f.name];
      if (f.type === "bool") return v ? "Sim" : "Não";
      if (f.type === "lookup") return labels[f.name]?.get(String(v)) ?? "—";
      if (f.type === "select") return f.options?.find((o) => o.value === v)?.label ?? (v ? String(v) : "—");
      if (v instanceof Date) return formatCivil(v);
      return v === null || v === undefined || v === "" ? "—" : String(v);
    },
  }));
  return (
    <>
      <PageHeader title={e.title} subtitle={e.description} breadcrumbs={[{ label: "Configurador", href: "/app/config" }, { label: e.title }]} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Toolbar base={`/app/config/${key}`} params={sp} />
          <DataTable
            rows={rows as { id: string }[]}
            columns={[
              ...cols,
              ...(e.hasActive ? [{ key: "active", label: "Situação", render: (r: Record<string, unknown>) => <StatusBadge status={r.active ? "ACTIVE" : "INACTIVE"} /> }] : []),
              { key: "_actions", label: "", render: (r: Record<string, unknown>) => (
                <div className="flex gap-2">
                  <Link className="text-sm text-brand-700 hover:underline" href={`/app/config/${key}/${r.id}`}>Editar</Link>
                  {e.hasActive && <ActionButton action={toggleConfigAction} fields={{ key, id: String(r.id), active: r.active ? "false" : "true" }} variant="secondary">{r.active ? "Inativar" : "Ativar"}</ActionButton>}
                </div>
              ) },
            ]}
          />
          <Pagination base={`/app/config/${key}`} params={sp} page={q.page} pageSize={q.pageSize} total={total} />
        </div>
        <Card title="Novo registro"><ConfigForm entityKey={key} fields={e.fields} lookups={lookups} /></Card>
      </div>
    </>
  );
}
