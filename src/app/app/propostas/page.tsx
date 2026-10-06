import { PageHeader, Card, StatusBadge } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { ActionForm, Input, Select, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { lookups, nameMap } from "@/modules/config/lookups";
import { pageQuery, sp, textSearch, type SearchParams } from "@/lib/query";
import { formatMoney } from "@/lib/money";
import { formatInstant } from "@/lib/dates";
import { statusLabel, COMMERCIAL_MODELS } from "@/lib/labels";
import { createProposalAction } from "./actions";

export const metadata = { title: "Propostas" };
export default async function ProposalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pagePerm(ctx, "crm.read");
  const q = pageQuery(s);
  const status = sp(s, "status");
  const where = { AND: [textSearch(q.q, ["title", "number"]), status ? { status } : {}] };
  const [rows, total] = await Promise.all([ctx.db.proposal.findMany({ where, orderBy: { updatedAt: "desc" }, skip: q.skip, take: q.take }), ctx.db.proposal.count({ where })]);
  const versions = await ctx.db.proposalVersion.findMany({ where: { proposalId: { in: rows.map((r) => r.id) } } });
  const cur = new Map(rows.map((r) => [r.id, versions.find((v) => v.proposalId === r.id && v.version === r.currentVersion)]));
  const parties = await nameMap(ctx, "party", rows.map((r) => r.partyId));
  const canMargin = ctx.permissions.has("margin.view");
  const [companies, customers] = await Promise.all([lookups.companies(ctx), lookups.customers(ctx)]);
  return (
    <>
      <PageHeader title="Propostas" breadcrumbs={[{ label: "Comercial" }, { label: "Propostas" }]} />
      <div className="grid gap-6 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <Toolbar base="/app/propostas" params={s} filters={[{ name: "status", label: "Situação", options: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "ACCEPTED", "REJECTED"].map((v) => ({ value: v, label: statusLabel(v) })) }]} />
          <DataTable rows={rows} rowHref={(p) => `/app/propostas/${p.id}`} columns={[
            { key: "number", label: "Número" }, { key: "title", label: "Título" }, { key: "party", label: "Cliente", render: (p) => parties.get(p.partyId) },
            { key: "v", label: "Versão", render: (p) => `v${p.currentVersion}` }, { key: "model", label: "Modelo", render: (p) => statusLabel(cur.get(p.id)?.commercialModel ?? "") },
            { key: "net", label: "Receita líquida", align: "right", render: (p) => formatMoney(cur.get(p.id)?.netRevenue ?? 0) },
            ...(canMargin ? [{ key: "m", label: "Margem", align: "right" as const, render: (p: (typeof rows)[number]) => `${cur.get(p.id)?.marginPct.toFixed(1)}%` }] : []),
            { key: "status", label: "Situação", render: (p) => <StatusBadge status={p.status} /> }, { key: "u", label: "Atualizada", render: (p) => formatInstant(p.updatedAt, ctx.timezone) },
          ]} />
          <Pagination base="/app/propostas" params={s} page={q.page} pageSize={q.pageSize} total={total} />
        </div>
        {ctx.permissions.has("proposal.write") && (
          <Card title="Nova proposta">
            <ActionForm action={createProposalAction}>
              <Select name="companyId" label="Empresa" options={companies} required />
              <Select name="partyId" label="Cliente" options={customers} placeholder="Selecione" required />
              <Input name="title" label="Título" required />
              <Select name="commercialModel" label="Modelo" options={COMMERCIAL_MODELS.map((m) => ({ value: m, label: statusLabel(m) }))} />
              <SubmitButton>Criar</SubmitButton>
            </ActionForm>
            <p className="mt-2 text-xs text-slate-500">Dica: crie a partir da oportunidade para reaproveitar cliente e serviços.</p>
          </Card>
        )}
      </div>
    </>
  );
}
