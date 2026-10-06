import { PageHeader, Card, StatusBadge } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { requireCtx } from "@/server/auth/next";
import { listProfessionals } from "@/modules/professionals/service";
import { nameMap } from "@/modules/config/lookups";
import { pageQuery, sp, type SearchParams } from "@/lib/query";
import { statusLabel } from "@/lib/labels";
import { formatQty } from "@/lib/money";
import { ProfessionalForm } from "./professional-form";
import { createProfessionalAction } from "./actions";
import { profLookups } from "./lk";

export const metadata = { title: "Profissionais" };

export default async function ProfessionalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  const q = pageQuery(s);
  const lk = await profLookups(ctx);
  const { rows, total } = await listProfessionals(ctx, q, { active: sp(s, "situacao"), employmentType: sp(s, "vinculo"), seniorityId: sp(s, "senioridade"), skillId: sp(s, "competencia") });
  const [roles, sens] = await Promise.all([nameMap(ctx, "teamRole", rows.map((r) => r.teamRoleId)), nameMap(ctx, "seniorityLevel", rows.map((r) => r.seniorityId))]);
  const canWrite = ctx.permissions.has("master.write") || ctx.permissions.has("resource.write");
  return (
    <>
      <PageHeader title="Profissionais" subtitle="Banco de profissionais internos e externos. Custos têm acesso restrito." breadcrumbs={[{ label: "Cadastros" }, { label: "Profissionais" }]} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Toolbar base="/app/cadastros/profissionais" params={s} exportHref="/api/export/profissionais" filters={[
            { name: "vinculo", label: "Vínculo", options: ["CLT", "PJ", "PARTNER", "OTHER"].map((v) => ({ value: v, label: statusLabel(v) })) },
            { name: "senioridade", label: "Senioridade", options: lk.seniorities },
            { name: "competencia", label: "Competência", options: lk.skills },
            { name: "situacao", label: "Situação", options: [{ value: "inactive", label: "Inativos" }, { value: "all", label: "Todos" }] },
          ]} />
          <DataTable rows={rows} rowHref={(p) => `/app/cadastros/profissionais/${p.id}`} columns={[
            { key: "name", label: "Nome" },
            { key: "employmentType", label: "Vínculo", render: (p) => statusLabel(p.employmentType) },
            { key: "role", label: "Papel / senioridade", render: (p) => [roles.get(p.teamRoleId ?? ""), sens.get(p.seniorityId ?? "")].filter(Boolean).join(" · ") || "—" },
            { key: "capacityPct", label: "Capacidade", align: "right", render: (p) => `${formatQty(p.capacityPct, 0)}%` },
            { key: "active", label: "Situação", render: (p) => <StatusBadge status={p.active ? "ACTIVE" : "INACTIVE"} /> },
          ]} />
          <Pagination base="/app/cadastros/profissionais" params={s} page={q.page} pageSize={q.pageSize} total={total} />
        </div>
        {canWrite && <Card title="Novo profissional"><ProfessionalForm action={createProfessionalAction} lk={lk} /></Card>}
      </div>
    </>
  );
}
