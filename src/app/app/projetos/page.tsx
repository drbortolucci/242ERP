import Link from "next/link";
import { getTerms } from "@/modules/sectors/service";
import { PageHeader, Card, StatusBadge } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { ActionForm, Checkbox, FormGrid, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { baselineSuggestion } from "@/modules/projects/service";
import { lookups, nameMap, userNameMap } from "@/modules/config/lookups";
import { pageQuery, sp, textSearch, type SearchParams } from "@/lib/query";
import { formatCivil } from "@/lib/dates";
import { statusLabel } from "@/lib/labels";
import { createProjectAction } from "./actions";

export const metadata = { title: "Projetos" };
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  const terms = await getTerms(ctx);
  pagePerm(ctx, "project.read");
  const q = pageQuery(s);
  const status = sp(s, "status");
  const mine = sp(s, "meus") === "1";
  const where = { AND: [textSearch(q.q, ["name", "code"]), status ? { status } : {}, mine ? { managerUserId: ctx.userId } : {}] };
  const [rows, total] = await Promise.all([ctx.db.project.findMany({ where, orderBy: { createdAt: "desc" }, skip: q.skip, take: q.take }), ctx.db.project.count({ where })]);
  const [parties, users] = await Promise.all([nameMap(ctx, "party", rows.map((r) => r.partyId)), userNameMap(rows.map((r) => r.managerUserId))]);
  const contractId = sp(s, "contrato");
  const showNew = sp(s, "novo") === "1" && ctx.permissions.has("project.write");
  const contract = contractId ? await ctx.db.contract.findFirst({ where: { id: contractId } }) : null;
  const sug = contractId ? await baselineSuggestion(ctx, contractId) : null;
  const [companies, customers, types, users2] = showNew ? await Promise.all([lookups.companies(ctx), lookups.customers(ctx), lookups.projectTypes(ctx), lookups.users(ctx)]) : [[], [], [], []];
  const typeForModel = contract?.commercialModel === "AMS_RECURRING" ? "AMS" : contract?.commercialModel === "MONTHLY_ALLOCATION" ? "Alocação" : contract?.commercialModel === "TRAINING" ? "Treinamento" : contract?.commercialModel === "ADVISORY" ? "Advisory" : "Implementação ERP";
  return (
    <>
      <PageHeader title={terms.projects} breadcrumbs={[{ label: "Operação" }, { label: terms.projects }]} actions={<>
        <Link className="rounded-md border bg-white px-3 py-1.5 text-sm" href="/app/projetos/portfolio">Portfólio executivo</Link>
        {ctx.permissions.has("project.write") && <Link className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white" href="/app/projetos?novo=1">Novo projeto</Link>}
      </>} />
      {showNew && (
        <Card title={contract ? `Novo projeto a partir do contrato ${contract.number}` : "Novo projeto"} className="mb-6">
          <ActionForm action={createProjectAction}>
            {contract && <input type="hidden" name="contractId" value={contract.id} />}
            <FormGrid cols={3}>
              <Input name="name" label="Nome" required defaultValue={contract?.title ?? ""} />
              {contract ? <><input type="hidden" name="companyId" value={contract.companyId} /><input type="hidden" name="partyId" value={contract.partyId} /></> : <><Select name="companyId" label="Empresa" options={companies} required /><Select name="partyId" label="Cliente" options={customers} required placeholder="Selecione" /></>}
              <Select name="projectTypeId" label="Tipo (modelo de WBS)" options={types} placeholder="—" defaultValue={types.find((t) => t.label === typeForModel)?.value} />
              <Select name="managerUserId" label="Gestor" options={users2} placeholder="Eu" />
              <Select name="progressMethod" label="Critério de avanço" options={[{ value: "HOURS", label: "Horas realizadas ÷ planejadas" }, { value: "MILESTONES", label: "Marcos aceitos ÷ total" }, { value: "TASK_WEIGHT", label: "Peso das atividades concluídas" }, { value: "MANUAL", label: "Manual (sem EVM)" }]} defaultValue={contract?.commercialModel === "FIXED_PRICE" ? "HOURS" : "HOURS"} />
              <Input name="plannedStart" type="date" label="Início planejado" required defaultValue={sug?.plannedStart} />
              <Input name="plannedEnd" type="date" label="Término planejado" required defaultValue={sug?.plannedEnd} />
            </FormGrid>
            <fieldset className="rounded border p-3"><legend className="px-1 text-xs font-medium">Linha de base original (orçamento) — sugerida pela proposta aceita</legend>
              <FormGrid cols={4}><Input name="effortHours" label="Esforço (h)" defaultValue={sug?.effortHours ?? "0"} /><Input name="revenue" label="Receita" defaultValue={sug?.revenue ?? "0"} /><Input name="laborCost" label="Custo de pessoal" defaultValue={sug?.laborCost ?? "0"} /><Input name="thirdPartyCost" label="Terceiros/licenças" defaultValue={sug?.thirdPartyCost ?? "0"} /><Input name="expenseCost" label="Despesas" defaultValue={sug?.expenseCost ?? "0"} /></FormGrid>
            </fieldset>
            <Textarea name="description" label="Escopo / descrição" />
            <Checkbox name="applyTemplate" label="Gerar WBS a partir do modelo do tipo de projeto" defaultChecked />
            <SubmitButton>Criar projeto</SubmitButton>
          </ActionForm>
        </Card>
      )}
      <Toolbar base="/app/projetos" params={s} filters={[{ name: "status", label: "Situação", options: ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELED"].map((v) => ({ value: v, label: statusLabel(v) })) }, { name: "meus", label: "Gestor", options: [{ value: "1", label: "Meus projetos" }] }]} />
      <DataTable rows={rows} rowHref={(p) => `/app/projetos/${p.id}`} columns={[
        { key: "code", label: "Código" }, { key: "name", label: "Projeto" }, { key: "party", label: "Cliente", render: (p) => parties.get(p.partyId) }, { key: "mgr", label: "Gestor", render: (p) => users.get(p.managerUserId ?? "") ?? "—" },
        { key: "period", label: "Planejado", render: (p) => `${formatCivil(p.plannedStart)} – ${formatCivil(p.plannedEnd)}` }, { key: "status", label: "Situação", render: (p) => <StatusBadge status={p.status} /> }, { key: "fin", label: "Financeiro", render: (p) => <StatusBadge status={p.financialStatus} /> },
      ]} />
      <Pagination base="/app/projetos" params={s} page={q.page} pageSize={q.pageSize} total={total} />
    </>
  );
}
