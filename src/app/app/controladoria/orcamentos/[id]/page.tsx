import { notFound } from "next/navigation";
import { PageHeader, Card, StatusBadge } from "@/components/ui/page";
import { ActionButton, ActionForm, FormGrid, Select, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { lookups } from "@/modules/config/lookups";
import { toCivil } from "@/lib/dates";
import { dec, formatMoney } from "@/lib/money";
import { budgetLineAction, approveBudgetAction } from "../../actions";

export default async function BudgetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  pagePerm(ctx, "controlling.read");
  const b = await ctx.db.budget.findFirst({ where: { id } });
  if (!b) notFound();
  const [lines, accounts, ccs, projects] = await Promise.all([ctx.db.budgetLine.findMany({ where: { budgetId: id } }), ctx.db.managerialAccount.findMany({ orderBy: { code: "asc" } }), lookups.costCenters(ctx), ctx.db.project.findMany({ orderBy: { code: "asc" } })]);
  const months = Array.from({ length: 12 }, (_, i) => `${b.year}-${String(i + 1).padStart(2, "0")}-01`);
  const keys = [...new Set(lines.map((l) => `${l.accountId}|${l.costCenterId ?? ""}|${l.projectId ?? ""}`))];
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const ccName = new Map(ccs.map((c) => [c.value, c.label]));
  const pjName = new Map(projects.map((p) => [p.id, `${p.code} ${p.name}`]));
  const editable = b.status === "DRAFT" && ctx.permissions.has("controlling.write");
  return (
    <>
      <PageHeader title={`${b.name} — v${b.version}`} subtitle={<StatusBadge status={b.status} />} breadcrumbs={[{ label: "Orçamentos", href: "/app/controladoria/orcamentos" }, { label: b.name }]}
        actions={editable && <ActionButton action={approveBudgetAction} fields={{ id }} variant="primary" confirm="Aprovar esta versão? Ela ficará imutável.">Aprovar versão</ActionButton>} />
      <Card title="Linhas (por mês)">
        <div className="overflow-x-auto"><table className="min-w-full text-xs">
          <thead><tr className="text-left text-slate-500"><th className="p-1">Conta / CC / projeto</th>{months.map((m) => <th key={m} className="p-1 text-right">{m.slice(5, 7)}</th>)}<th className="p-1 text-right">Total</th></tr></thead>
          <tbody>{keys.map((k) => {
            const [a, cc, pj] = k.split("|");
            const ls = lines.filter((l) => `${l.accountId}|${l.costCenterId ?? ""}|${l.projectId ?? ""}` === k);
            return <tr key={k} className="border-t"><td className="p-1">{acc.get(a)?.code} {acc.get(a)?.name}{cc && ` · ${ccName.get(cc)}`}{pj && ` · ${pjName.get(pj)}`}</td>{months.map((m) => <td key={m} className="p-1 text-right tabular-nums">{formatMoney(ls.find((l) => toCivil(l.month) === m)?.amount ?? 0)}</td>)}<td className="p-1 text-right font-medium">{formatMoney(ls.reduce((s, l) => s.plus(l.amount), dec(0)))}</td></tr>;
          })}</tbody>
        </table></div>
      </Card>
      {editable && (
        <Card title="Incluir/alterar linha" className="mt-6">
          <ActionForm action={budgetLineAction}>
            <input type="hidden" name="budgetId" value={id} />
            <FormGrid cols={3}><Select name="accountId" label="Conta" options={accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} required /><Select name="costCenterId" label="Centro de custo" options={ccs} placeholder="—" /><Select name="projectId" label="Projeto" options={projects.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` }))} placeholder="—" /></FormGrid>
            <div className="grid grid-cols-3 gap-2 md:grid-cols-6 xl:grid-cols-12">{months.map((m) => <label key={m} className="text-xs">{m.slice(5, 7)}/{b.year}<input type="hidden" name="months[]" value={m} /><input name="amounts[]" defaultValue="0" className="w-full rounded border px-1 py-1 text-right" /></label>)}</div>
            <SubmitButton>Salvar linha</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
