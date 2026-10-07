import { PageHeader, Card, StatusBadge, Badge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionForm, FormGrid, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { lookups, nameMap, userNameMap } from "@/modules/config/lookups";
import { addMonths, formatCivil, monthStart, todayIn } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { allocationRuleAction, runAllocationAction, reverseAllocationAction } from "../actions";

const BASIS: Record<string, string> = { FIXED_PERCENT: "Percentual fixo", HOURS: "Horas aprovadas nos projetos", REVENUE: "Receita reconhecida dos projetos" };

export const metadata = { title: "Rateios" };
export default async function AllocationsPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "controlling.read");
  const [rules, runs, companies, accounts, ccs] = await Promise.all([ctx.db.allocationRule.findMany({ orderBy: [{ name: "asc" }, { version: "desc" }] }), ctx.db.allocationRun.findMany({ orderBy: { createdAt: "desc" }, take: 30 }), lookups.companies(ctx), lookups.accounts(ctx), lookups.costCenters(ctx)]);
  const acc = new Map(accounts.map((a) => [a.value, a.label]));
  const cc = new Map(ccs.map((c) => [c.value, c.label]));
  const [cn, users] = await Promise.all([nameMap(ctx, "company", rules.map((r) => r.companyId)), userNameMap(runs.map((r) => r.createdById))]);
  const rn = new Map(rules.map((r) => [r.id, `${r.name} v${r.version}`]));
  const can = ctx.permissions.has("controlling.write");
  const prev = addMonths(monthStart(todayIn(ctx.timezone)), -1);
  return (
    <>
      <PageHeader title="Rateios de despesas indiretas" subtitle="Critérios versionados; a soma após o rateio é igual à soma antes (origem − destinos = 0)" breadcrumbs={[{ label: "Controladoria" }, { label: "Rateios" }]} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Regras">
            <DataTable dense rows={rules} columns={[
              { key: "n", label: "Regra", render: (r) => <>{r.name} <Badge>v{r.version}</Badge>{!r.active && <Badge tone="slate">substituída</Badge>}</> }, { key: "c", label: "Empresa", render: (r) => cn.get(r.companyId) },
              { key: "o", label: "Origem", render: (r) => `${acc.get(r.sourceAccountId)}${r.sourceCostCenterId ? ` · ${cc.get(r.sourceCostCenterId)}` : ""}` }, { key: "b", label: "Critério", render: (r) => BASIS[r.basis] },
              { key: "d", label: "Destino", render: (r) => acc.get(r.targetAccountId) }, { key: "v", label: "Vigência", render: (r) => `${formatCivil(r.validFrom)}${r.validTo ? ` a ${formatCivil(r.validTo)}` : ""}` },
              { key: "x", label: "Executar", render: (r) => r.active && can ? <ActionForm action={runAllocationAction} className="flex items-end gap-1"><input type="hidden" name="ruleId" value={r.id} /><Input name="month" type="date" aria-label="Competência" defaultValue={prev} /><SubmitButton variant="secondary">Ratear</SubmitButton></ActionForm> : null },
            ]} />
          </Card>
          <Card title="Execuções">
            <DataTable dense rows={runs} columns={[{ key: "r", label: "Regra", render: (r) => rn.get(r.ruleId) ?? r.ruleId }, { key: "c", label: "Competência", render: (r) => formatCivil(r.competence).slice(3) }, { key: "v", label: "Valor rateado", align: "right", render: (r) => formatMoney(r.sourceAmount) }, { key: "u", label: "Por", render: (r) => users.get(r.createdById) }, { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> }, { key: "x", label: "", render: (r) => r.status === "POSTED" && can ? <ActionForm action={reverseAllocationAction} className="flex items-end gap-1"><input type="hidden" name="runId" value={r.id} /><Input name="reason" aria-label="Motivo" placeholder="Motivo" required /><SubmitButton variant="danger">Estornar</SubmitButton></ActionForm> : null }]} />
          </Card>
        </div>
        {can && (
          <Card title="Nova regra">
            <ActionForm action={allocationRuleAction}>
              <Select name="companyId" label="Empresa" options={companies} required />
              <Input name="name" label="Nome" required />
              <FormGrid cols={2}><Select name="sourceAccountId" label="Conta de origem" options={accounts} required /><Select name="sourceCostCenterId" label="CC de origem" options={ccs} placeholder="Todos" /></FormGrid>
              <FormGrid cols={2}><Select name="basis" label="Critério" options={Object.entries(BASIS).map(([value, label]) => ({ value, label }))} /><Select name="targetAccountId" label="Conta de destino" options={accounts} required /></FormGrid>
              <Input name="validFrom" type="date" label="Vigente desde" defaultValue={monthStart(todayIn(ctx.timezone))} required />
              <Textarea name="targets" label='Destinos (percentual fixo): [{"costCenterId":"…","percent":"60"}, {"projectId":"…","percent":"40"}]' rows={3} />
              <SubmitButton>Criar regra</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
