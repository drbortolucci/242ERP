import Link from "next/link";
import { PageHeader, Card, StatusBadge, Badge, Notice, EmptyState } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionForm, Checkbox, Input, SubmitButton, Textarea } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pageAnyPerm } from "@/server/page-guard";
import { lookups, userNameMap } from "@/modules/config/lookups";
import { closingChecklist } from "@/modules/controlling/service";
import { getSetting } from "@/server/settings";
import { sp, type SearchParams } from "@/lib/query";
import { addMonths, formatInstant, monthStart, todayIn, toCivil } from "@/lib/dates";
import { closePeriodAction, reopenPeriodAction, approveRecognitionAction } from "../actions";

export const metadata = { title: "Fechamento" };
export default async function ClosingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pageAnyPerm(ctx, "period.close", "controlling.read");
  const companies = await lookups.companies(ctx);
  const companyId = sp(s, "empresa") ?? companies[0]?.value;
  if (!companyId) return <><PageHeader title="Fechamento de períodos" breadcrumbs={[{ label: "Controladoria" }, { label: "Fechamento" }]} /><EmptyState title="Nenhuma empresa disponível" description="Cadastre uma empresa (ou peça acesso a uma) para controlar o fechamento de competências." /></>;
  const cur = monthStart(todayIn(ctx.timezone));
  const months = Array.from({ length: 6 }, (_, i) => addMonths(cur, -(i + 1)));
  const [periods, recog] = await Promise.all([ctx.db.accountingPeriod.findMany({ where: { companyId } }), getSetting(ctx, "revenueRecognition")]);
  const checks = await Promise.all(months.map(async (m) => ({ id: m, m, period: periods.find((p) => toCivil(p.month) === m), list: await closingChecklist(ctx, companyId, m) })));
  const users = await userNameMap(periods.flatMap((p) => [p.closedById, p.reopenedById]));
  return (
    <>
      <PageHeader title="Fechamento de períodos" breadcrumbs={[{ label: "Controladoria" }, { label: "Fechamento" }]} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">{companies.map((c) => <Link key={c.value} href={`?empresa=${c.value}`} className={`rounded border px-3 py-1 ${c.value === companyId ? "bg-slate-800 text-white" : ""}`}>{c.label}</Link>)}</div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Competências" className="xl:col-span-2">
          <DataTable rows={checks} columns={[
            { key: "m", label: "Competência", render: (r) => `${r.m.slice(5, 7)}/${r.m.slice(0, 4)}` },
            { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.period?.status === "CLOSED" ? "CLOSED" : "OPEN"} /> },
            { key: "p", label: "Pendências", render: (r) => { const p = r.list.filter((x) => x.count > 0); return p.length ? <ul className="text-xs">{p.map((x) => <li key={x.key}><Link className="text-brand-700 underline" href={x.href}>{x.label}: {x.count}</Link></li>)}</ul> : <Badge tone="green">nenhuma</Badge>; } },
            { key: "h", label: "Histórico", render: (r) => r.period ? <span className="text-xs">{r.period.closedAt && `Fechado por ${users.get(r.period.closedById ?? "")} em ${formatInstant(r.period.closedAt, ctx.timezone)}`}{r.period.reopenedAt && <><br />Reaberto por {users.get(r.period.reopenedById ?? "")}: {r.period.reopenReason}</>}</span> : "—" },
            { key: "a", label: "Ação", render: (r) => r.period?.status === "CLOSED"
              ? (ctx.permissions.has("period.reopen") ? <ActionForm action={reopenPeriodAction} className="flex items-end gap-1"><input type="hidden" name="companyId" value={companyId} /><input type="hidden" name="month" value={r.m} /><Input name="reason" aria-label="Justificativa da reabertura" placeholder="Justificativa" required /><SubmitButton variant="danger">Reabrir</SubmitButton></ActionForm> : null)
              : (ctx.permissions.has("period.close") ? <ActionForm action={closePeriodAction} className="space-y-1"><input type="hidden" name="companyId" value={companyId} /><input type="hidden" name="month" value={r.m} />{r.list.some((x) => x.count > 0) && <><Checkbox name="force" label="Fechar com pendências" /><Input name="reason" aria-label="Justificativa" placeholder="Justificativa" /></>}<SubmitButton variant="secondary" confirm="Fechar a competência? Alterações passarão a ser recusadas.">Fechar</SubmitButton></ActionForm> : null) },
          ]} />
          <p className="mt-2 text-xs text-slate-500">Ao fechar, o razão da competência é sincronizado e operações com data no período passam a ser recusadas (horas, despesas, títulos, medições, liquidações). Reabertura exige permissão específica e justificativa, e fica na auditoria.</p>
        </Card>
        <Card title="Regras de reconhecimento de receita">
          <p className="text-sm">{recog.notes}</p>
          <ul className="mt-2 list-disc pl-5 text-xs text-slate-600"><li>Horas e medições: receita na competência da medição aprovada</li><li>Marcos: no aceite do marco</li><li>Linear: mensalidade (ou valor ÷ meses) por competência</li><li>% de conclusão: valor do contrato × horas aprovadas ÷ esforço da linha de base</li><li>Deduções gerenciais pela alíquota informada no contrato</li></ul>
          {recog.approvedBy ? <div className="mt-3"><Notice tone="success">Aprovadas por {recog.approvedBy} em {recog.approvedAt ? formatInstant(new Date(recog.approvedAt), ctx.timezone) : "—"}.</Notice></div> : <div className="mt-3"><Notice tone="warn">Regras ainda não aprovadas pelo responsável da empresa.</Notice></div>}
          {ctx.permissions.has("controlling.write") && <ActionForm action={approveRecognitionAction} className="mt-3"><Textarea name="notes" label="Observações (opcional)" defaultValue={recog.notes ?? ""} /><SubmitButton variant="secondary">Registrar aprovação das regras</SubmitButton></ActionForm>}
        </Card>
      </div>
    </>
  );
}
