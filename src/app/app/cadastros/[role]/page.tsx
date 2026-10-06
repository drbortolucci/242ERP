import { notFound } from "next/navigation";
import { PageHeader, Card, StatusBadge, Badge } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { requireCtx } from "@/server/auth/next";
import { listParties } from "@/modules/parties/service";
import { customFieldDefs } from "@/modules/config/custom-fields";
import { pageQuery, sp, type SearchParams } from "@/lib/query";
import { formatDocument } from "@/lib/documents";
import { prisma } from "@/server/db";
import { ROLE_PAGES } from "../roles";
import { PartyForm } from "../party-form";

export default async function PartiesPage({ params, searchParams }: { params: Promise<{ role: string }>; searchParams: Promise<SearchParams> }) {
  const { role } = await params;
  const cfg = ROLE_PAGES[role];
  if (!cfg) notFound();
  const s = await searchParams;
  const ctx = await requireCtx();
  const q = pageQuery(s);
  const { rows, total } = await listParties(ctx, cfg.role, q, { active: sp(s, "situacao") });
  const canWrite = ctx.permissions.has("master.write");
  const [members, terms, cfs] = await Promise.all([ctx.db.membership.findMany({ where: { kind: "INTERNAL", active: true } }), ctx.db.paymentTerm.findMany({ where: { active: true } }), customFieldDefs(ctx, "PARTY")]);
  const users = await prisma.user.findMany({ where: { id: { in: members.map((m) => m.userId) } }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title={cfg.title} breadcrumbs={[{ label: "Cadastros" }, { label: cfg.title }]} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Toolbar base={`/app/cadastros/${role}`} params={s} exportHref={`/api/export/${cfg.dataset}`}
            filters={[{ name: "situacao", label: "Situação", options: [{ value: "active", label: "Ativos" }, { value: "inactive", label: "Inativos" }, { value: "all", label: "Todos" }] }]} />
          <DataTable rows={rows} rowHref={(p) => `/app/cadastros/${role}/${p.id}`} columns={[
            { key: "name", label: "Nome", render: (p) => p.tradeName ? `${p.name} (${p.tradeName})` : p.name },
            { key: "document", label: "Documento", render: (p) => formatDocument(p.document) },
            { key: "roles", label: "Papéis", render: (p) => <div className="flex flex-wrap gap-1">{p.isCustomer && <Badge tone="blue">Cliente</Badge>}{p.isProspect && <Badge>Prospect</Badge>}{p.isSupplier && <Badge tone="violet">Fornecedor</Badge>}{p.isPartner && <Badge tone="green">Parceiro</Badge>}</div> },
            { key: "email", label: "E-mail", render: (p) => p.email ?? "—" },
            { key: "active", label: "Situação", render: (p) => <StatusBadge status={p.active ? "ACTIVE" : "INACTIVE"} /> },
          ]} />
          <Pagination base={`/app/cadastros/${role}`} params={s} page={q.page} pageSize={q.pageSize} total={total} />
        </div>
        {canWrite && (
          <Card title={`Novo ${cfg.singular.toLowerCase()}`}>
            <PartyForm back={role} defaults={cfg.defaults} users={users.map((u) => ({ value: u.id, label: u.name }))} terms={terms.map((t) => ({ value: t.id, label: t.name }))} customFields={cfs} />
          </Card>
        )}
      </div>
    </>
  );
}
