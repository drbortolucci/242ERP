import { PageHeader, Card, StatusBadge } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { ActionButton, ActionForm, FormGrid, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { pageQuery, sp, textSearch, type SearchParams } from "@/lib/query";
import { formatInstant } from "@/lib/dates";
import { crmLookups } from "../lk";
import { createLeadAction, leadStatusAction, convertLeadAction } from "../actions";

export const metadata = { title: "Leads" };
export default async function LeadsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pagePerm(ctx, "crm.read");
  const q = pageQuery(s);
  const status = sp(s, "status");
  const where = { AND: [textSearch(q.q, ["name", "companyName", "email"]), status ? { status } : { status: { in: ["NEW", "QUALIFIED"] } }] };
  const [rows, total, lk] = await Promise.all([ctx.db.lead.findMany({ where, orderBy: { createdAt: "desc" }, skip: q.skip, take: q.take }), ctx.db.lead.count({ where }), crmLookups(ctx)]);
  const canWrite = ctx.permissions.has("crm.write");
  return (
    <>
      <PageHeader title="Leads" subtitle="Qualifique e converta em conta + oportunidade, reaproveitando os dados." breadcrumbs={[{ label: "Comercial" }, { label: "Leads" }]} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Toolbar base="/app/crm/leads" params={s} filters={[{ name: "status", label: "Situação", options: ["NEW", "QUALIFIED", "DISQUALIFIED", "CONVERTED"].map((v) => ({ value: v, label: v === "NEW" ? "Novo" : v === "QUALIFIED" ? "Qualificado" : v === "DISQUALIFIED" ? "Desqualificado" : "Convertido" })) }]} />
          <DataTable rows={rows} columns={[
            { key: "name", label: "Contato", render: (l) => <span>{l.name}<span className="block text-xs text-slate-500">{l.companyName ?? "—"} · {l.email ?? "—"}</span></span> },
            { key: "source", label: "Origem", render: (l) => l.source ?? "—" },
            { key: "serviceInterest", label: "Interesse", render: (l) => l.serviceInterest ?? "—" },
            { key: "status", label: "Situação", render: (l) => <StatusBadge status={l.status} /> },
            { key: "createdAt", label: "Criado", render: (l) => formatInstant(l.createdAt, ctx.timezone) },
            { key: "act", label: "Ações", render: (l) => canWrite && l.status !== "CONVERTED" && (
              <div className="space-y-1">
                <div className="flex gap-1">{l.status === "NEW" && <ActionButton action={leadStatusAction} fields={{ id: l.id, status: "QUALIFIED" }}>Qualificar</ActionButton>}<ActionButton action={leadStatusAction} fields={{ id: l.id, status: "DISQUALIFIED" }}>Desqualificar</ActionButton></div>
                <details><summary className="cursor-pointer text-xs text-brand-700">Converter</summary>
                  <ActionForm action={convertLeadAction}>
                    <input type="hidden" name="id" value={l.id} />
                    <Select name="companyId" label="Empresa" options={lk.companies} placeholder="Selecione" required />
                    <Input name="title" label="Título da oportunidade" defaultValue={l.serviceInterest ?? `Oportunidade ${l.companyName ?? l.name}`} required />
                    <Input name="estimatedValue" label="Valor estimado" required />
                    <Select name="serviceId" label="Serviço" options={lk.services} placeholder="—" />
                    <Input name="document" label="CNPJ (opcional)" />
                    <SubmitButton>Converter</SubmitButton>
                  </ActionForm>
                </details>
              </div>
            ) },
          ]} />
          <Pagination base="/app/crm/leads" params={s} page={q.page} pageSize={q.pageSize} total={total} />
        </div>
        {canWrite && (
          <Card title="Novo lead">
            <ActionForm action={createLeadAction} resetOnSuccess>
              <FormGrid cols={1}>
                <Input name="name" label="Nome do contato" required /><Input name="companyName" label="Empresa" /><Input name="email" type="email" label="E-mail" /><Input name="phone" label="Telefone" />
                <Input name="source" label="Origem (site, evento, indicação…)" /><Input name="serviceInterest" label="Serviço de interesse" />
                <Select name="ownerUserId" label="Responsável" options={lk.users} placeholder="Eu" /><Textarea name="notes" label="Observações" />
              </FormGrid>
              <SubmitButton>Cadastrar lead</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
