import { PageHeader, Card, Badge, StatusBadge, Notice } from "@/components/ui/page";
import { Pagination, Toolbar } from "@/components/ui/table";
import { ActionForm, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { lookups } from "@/modules/config/lookups";
import { pageQuery, sp, textSearch, type SearchParams } from "@/lib/query";
import { formatCivil, monthStart, todayIn, toCivil } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { manualEntryAction, reverseEntryAction, syncJournalAction } from "../actions";
import { EntryLines } from "./entry-lines";

const SOURCE: Record<string, string> = { BILLING_DOCUMENT: "Cobrança", PRODUCT_ORDER: "Venda de produtos", RECEIVABLE: "Título a receber", PAYABLE: "Conta a pagar", SETTLEMENT: "Liquidação", TRANSFER: "Transferência", BANK_TRANSACTION: "Banco", BANK_ACCOUNT: "Saldo inicial bancário", ADVANCE_APPLICATION: "Adiantamento", OFFSET: "Compensação", PAYROLL_IMPORT: "Folha", STOCK_MOVEMENT: "Estoque" };

export const metadata = { title: "Lançamentos contábeis" };
export default async function JournalPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  const q = pageQuery(s, 30);
  const origin = sp(s, "origem");
  const where = { AND: [textSearch(q.q, ["number", "description"]), origin ? { origin } : {}] };
  const [entries, total, companies, accounts] = await Promise.all([
    ctx.db.journalEntry.findMany({ where, orderBy: [{ date: "desc" }, { number: "desc" }], skip: q.skip, take: q.take }), ctx.db.journalEntry.count({ where }),
    lookups.companies(ctx), ctx.db.ledgerAccount.findMany({ orderBy: { code: "asc" } }),
  ]);
  const lines = await ctx.db.journalLine.findMany({ where: { entryId: { in: entries.map((e) => e.id) } } });
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const canWrite = ctx.permissions.has("accounting.write");
  const today = todayIn(ctx.timezone);
  return (
    <>
      <PageHeader title="Lançamentos contábeis (diário)" subtitle="Automáticos a partir das operações e manuais (balanceados); correção sempre por estorno" breadcrumbs={[{ label: "Contabilidade" }, { label: "Lançamentos" }]} />
      {!accounts.length && <Notice tone="warn">Crie o plano de contas em Contabilidade › Plano de contas antes de contabilizar.</Notice>}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Toolbar base="/app/contabilidade/lancamentos" params={s} filters={[{ name: "origem", label: "Origem", options: [{ value: "AUTO", label: "Automático" }, { value: "MANUAL", label: "Manual" }] }]} />
          <div className="space-y-2">
            {entries.length === 0 && <p className="text-sm text-slate-500">Nenhum lançamento. Use “Contabilizar mês”.</p>}
            {entries.map((e) => (
              <div key={e.id} className="rounded border bg-white p-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><b>{e.number}</b> · {formatCivil(e.date)} · {e.description} {e.origin === "AUTO" ? <Badge tone="blue">{SOURCE[e.sourceType ?? ""] ?? "automático"}</Badge> : <Badge>manual</Badge>} {e.status === "REVERSED" && <StatusBadge status="REVERSED" />} {e.reversalOfId && <Badge tone="red">estorno</Badge>}</span>
                  {canWrite && e.origin === "MANUAL" && e.status === "POSTED" && !e.reversalOfId && (
                    <ActionForm action={reverseEntryAction} className="flex items-end gap-1"><input type="hidden" name="id" value={e.id} /><input type="hidden" name="date" value={today < toCivil(e.date) ? toCivil(e.date) : today} /><Input name="reason" aria-label="Motivo do estorno" placeholder="Motivo" required /><SubmitButton variant="danger" confirm="Estornar o lançamento?">Estornar</SubmitButton></ActionForm>
                  )}
                </div>
                <table className="mt-1 w-full text-xs">
                  <tbody>{lines.filter((l) => l.entryId === e.id).map((l) => (
                    <tr key={l.id} className="border-t"><td className="py-0.5 font-mono">{acc.get(l.accountId)?.code}</td><td>{acc.get(l.accountId)?.name}{l.memo ? ` — ${l.memo}` : ""}</td><td className="text-right tabular-nums">{Number(l.debit) ? formatMoney(l.debit) : ""}</td><td className="text-right tabular-nums">{Number(l.credit) ? formatMoney(l.credit) : ""}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            ))}
          </div>
          <Pagination base="/app/contabilidade/lancamentos" params={s} page={q.page} pageSize={q.pageSize} total={total} />
        </div>
        {canWrite && accounts.length > 0 && (
          <div className="space-y-6">
            <Card title="Contabilizar mês">
              <p className="mb-2 text-xs text-slate-500">Gera os lançamentos que faltam das operações do mês (idempotente). Meses fechados não recebem lançamentos.</p>
              <ActionForm action={syncJournalAction}>
                <FormGrid cols={2}><Select name="companyId" label="Empresa" options={companies} required /><Input name="month" type="date" label="Mês (qualquer dia)" defaultValue={monthStart(today)} required /></FormGrid>
                <SubmitButton>Contabilizar</SubmitButton>
              </ActionForm>
            </Card>
            <Card title="Lançamento manual">
              <ActionForm action={manualEntryAction} resetOnSuccess noImplicitSubmit>
                <FormGrid cols={2}><Select name="companyId" label="Empresa" options={companies} required /><Input name="date" type="date" label="Data" defaultValue={today} required /></FormGrid>
                <Input name="description" label="Histórico" required placeholder="Ex.: Saldos de implantação" />
                <EntryLines accounts={accounts.filter((a) => a.analytic && a.active).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} />
                <SubmitButton>Registrar lançamento</SubmitButton>
              </ActionForm>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
