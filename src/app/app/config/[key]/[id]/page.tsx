import { notFound } from "next/navigation";
import { PageHeader, Card } from "@/components/ui/page";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { getConfig, lookupOptions, fromDb } from "@/modules/config/service";
import { getConfigEntity } from "@/modules/config/registry";
import { ConfigForm } from "../../config-form";

export default async function ConfigEditPage({ params }: { params: Promise<{ key: string; id: string }> }) {
  const { key, id } = await params;
  if (!getConfigEntity(key)) notFound();
  const ctx = await requireCtx();
  pagePerm(ctx, "settings.manage");
  const { entity: e, row } = await getConfig(ctx, key, id);
  const lookups: Record<string, { value: string; label: string }[]> = {};
  for (const f of e.fields.filter((x) => x.type === "lookup")) lookups[f.name] = await lookupOptions(ctx, f);
  return (
    <>
      <PageHeader title={`Editar — ${e.title}`} breadcrumbs={[{ label: "Configurador", href: "/app/config" }, { label: e.title, href: `/app/config/${key}` }, { label: "Editar" }]} />
      <Card><ConfigForm entityKey={key} id={id} fields={e.fields} values={fromDb(e, row)} lookups={lookups} /></Card>
    </>
  );
}
