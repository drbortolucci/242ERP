import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card, DefinitionList, Stat, Grid, Badge, StatusBadge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionButton, ActionForm, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { nameMap, userNameMap } from "@/modules/config/lookups";
import { hourBankSummary } from "@/modules/ams/hour-bank";
import { formatCivil, toCivil } from "@/lib/dates";
import { dec, formatMoney, formatQty } from "@/lib/money";
import { syncHourBankAction, manualEntryAction, overageDecisionAction } from "../../actions";

const KIND: Record<string, string> = { CREDIT: "Crédito", DEBIT: "Consumo", EXPIRE: "Expiração", ADJUST: "Ajuste", OVERAGE: "Excedente" };
const OV: Record<string, [string, "amber" | "green" | "slate" | "red"]> = { PENDING: ["aguardando decisão", "amber"], APPROVED: ["cobrável", "green"], WAIVED: ["abonado", "slate"], ABSORBED: ["absorvido (política)", "red"] };

export default async function HourBankPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  pagePerm(ctx, "ams.manage");
  const s = await hourBankSummary(ctx, id).catch(() => null);
  if (!s || s.contract.commercialModel !== "AMS_RECURRING") notFound();
  const c = s.contract;
  const entryIds = s.entries.filter((e) => e.sourceType === "TIME_ENTRY").map((e) => e.sourceId!);
  const [pn, entries] = await Promise.all([nameMap(ctx, "party", [c.partyId]), ctx.db.timeEntry.findMany({ where: { id: { in: entryIds } }, select: { id: true, date: true, ticketId: true, description: true, professionalId: true } })]);
  const [profs, users, tickets] = await Promise.all([nameMap(ctx, "professional", entries.map((e) => e.professionalId)), userNameMap(s.entries.map((e) => e.decidedById ?? e.createdById)), ctx.db.ticket.findMany({ where: { id: { in: entries.map((e) => e.ticketId).filter((x): x is string => !!x) } }, select: { id: true, number: true } })]);
  const te = new Map(entries.map((e) => [e.id, e]));
  const tk = new Map(tickets.map((t) => [t.id, t.number]));
  const overages = s.entries.filter((e) => e.kind === "OVERAGE").reverse();
  const credits = s.credits.slice().reverse();
  return (
    <>
      <PageHeader title={`Banco de horas — ${c.number}`} subtitle={`${pn.get(c.partyId)} · ${c.title}`} breadcrumbs={[{ label: "Saldos e franquias", href: "/app/ams/saldos" }, { label: c.number }]}
        actions={<ActionButton action={syncHourBankAction} fields={{ contractId: id }} variant="primary">Apurar agora</ActionButton>} />
      <Grid cols={5}>
        <Stat label="Saldo disponível" value={`${formatQty(s.available)} h`} tone={s.lowBalance ? "warn" : "good"} hint={s.lowBalance ? `abaixo de ${c.lowBalancePct}% da franquia` : undefined} />
        <Stat label="Consumido no mês" value={`${formatQty(s.consumedMonth)} h`} hint={`franquia ${formatQty(s.franchise)} h`} />
        <Stat label="Vence em 30 dias" value={`${formatQty(s.expiringSoon)} h`} tone={s.expiringSoon.gt(0) ? "warn" : "default"} />
        <Stat label="Excedente pendente" value={`${formatQty(s.overagePendingHours)} h`} tone={s.overagePendingHours.gt(0) ? "bad" : "default"} />
        <Stat label="Excedente cobrável" value={formatMoney(s.overageBillableValue)} hint={`${formatQty(s.overageBillableHours)} h × ${formatMoney(c.overageRate ?? 0)}`} />
      </Grid>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Evolução mensal (horas)">
            <DataTable dense rows={s.series.map((r) => ({ ...r, id: r.month }))} columns={[{ key: "month", label: "Mês", render: (r) => r.month.split("-").reverse().join("/") }, { key: "c", label: "Créditos", align: "right", render: (r) => formatQty(r.credited) }, { key: "u", label: "Consumo", align: "right", render: (r) => formatQty(r.consumed) }, { key: "e", label: "Expirado", align: "right", render: (r) => formatQty(r.expired) }, { key: "o", label: "Excedente", align: "right", render: (r) => r.overage ? <span className="text-red-700">{formatQty(r.overage)}</span> : "0,00" }]} />
          </Card>
          <Card title="Excedentes">
            <DataTable dense rows={overages} empty="Nenhum excedente." columns={[
              { key: "m", label: "Competência", render: (e) => formatCivil(e.month).slice(3) }, { key: "h", label: "Horas", align: "right", render: (e) => formatQty(dec(e.hours).negated()) },
              { key: "v", label: "Valor", align: "right", render: (e) => formatMoney(dec(e.hours).negated().times(c.overageRate ?? 0)) },
              { key: "o", label: "Origem", render: (e) => { const t = te.get(e.sourceId ?? ""); return t ? <>{profs.get(t.professionalId)} · {toCivil(t.date).split("-").reverse().join("/")}{t.ticketId && <> · <Link className="text-brand-700 underline" href={`/app/ams/chamados/${t.ticketId}`}>{tk.get(t.ticketId)}</Link></>}</> : "—"; } },
              { key: "s", label: "Situação", render: (e) => { const [l, tone] = OV[e.overageStatus ?? "PENDING"]; return <Badge tone={tone}>{l}</Badge>; } },
              { key: "d", label: "Decisão", render: (e) => e.overageStatus === "PENDING" ? (
                <ActionForm action={overageDecisionAction} className="flex flex-wrap items-end gap-1"><input type="hidden" name="id" value={e.id} /><input type="hidden" name="contractId" value={id} /><Input name="note" aria-label="Justificativa" placeholder="Justificativa" required /><Select name="approve" aria-label="Decisão" options={[{ value: "1", label: "Cobrar" }, { value: "0", label: "Abonar" }]} /><SubmitButton variant="secondary">OK</SubmitButton></ActionForm>
              ) : <span className="text-xs text-slate-500">{e.decisionNote}{e.decidedById ? ` — ${users.get(e.decidedById)}` : ""}</span> },
            ]} />
          </Card>
          <Card title="Créditos e saldos (FIFO por vencimento)">
            <DataTable dense rows={credits} columns={[{ key: "f", label: "Vigente desde", render: (x) => formatCivil(x.validFrom) }, { key: "o", label: "Origem", render: (x) => x.entry.notes ?? x.entry.sourceType ?? "" }, { key: "h", label: "Crédito", align: "right", render: (x) => formatQty(x.entry.hours) }, { key: "r", label: "Saldo", align: "right", render: (x) => formatQty(x.remaining) }, { key: "e", label: "Vence em", render: (x) => x.expiresOn ? formatCivil(x.expiresOn) : "sem vencimento" }]} />
          </Card>
          <Card title="Razão de horas (últimos lançamentos)">
            <DataTable dense rows={s.entries.slice(-60).reverse()} columns={[{ key: "m", label: "Competência", render: (e) => formatCivil(e.month).slice(3) }, { key: "k", label: "Tipo", render: (e) => KIND[e.kind] ?? e.kind }, { key: "h", label: "Horas", align: "right", render: (e) => formatQty(e.hours) }, { key: "o", label: "Origem", render: (e) => e.sourceType === "TIME_ENTRY" ? te.get(e.sourceId ?? "")?.description ?? "apontamento" : e.notes ?? e.sourceType }, { key: "u", label: "Por", render: (e) => users.get(e.createdById ?? "") ?? "—" }]} />
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Contrato">
            <DefinitionList items={[
              { label: "Contrato", value: <Link className="text-brand-700 underline" href={`/app/contratos/${c.id}`}>{c.number}</Link> }, { label: "Situação", value: <StatusBadge status={c.status} /> },
              { label: "Mensalidade", value: formatMoney(c.monthlyFee ?? 0) }, { label: "Franquia mensal", value: `${formatQty(c.franchiseHours ?? 0)} h` },
              { label: "Tarifa de excedente", value: formatMoney(c.overageRate ?? 0) }, { label: "Política de excedente", value: ({ BILL: "Cobrar automaticamente", REQUIRE_APPROVAL: "Exige aprovação", BLOCK: "Não cobrar (absorver)" } as Record<string, string>)[c.overagePolicy] },
              { label: "Banco de horas", value: ({ ACCUMULATE: `Acumula por ${c.hourBankExpiryMonths ?? 0} mês(es) após o mês de crédito`, PREPAID: "Pré-pago (créditos comprados)", NONE: "Não acumula (expira no fim do mês)" } as Record<string, string>)[c.hourBankPolicy ?? "NONE"] },
              { label: "Alerta de saldo baixo", value: `${c.lowBalancePct}% da franquia` },
            ]} />
          </Card>
          <Card title="Lançamento manual">
            <ActionForm action={manualEntryAction} resetOnSuccess>
              <input type="hidden" name="contractId" value={id} />
              <Select name="kind" label="Tipo" options={[{ value: "PREPAID_PURCHASE", label: "Compra de horas pré-pagas" }, { value: "ADJUST", label: "Ajuste (+ crédito / − débito)" }]} />
              <FormGrid cols={2}><Input name="hours" label="Horas" required /><Input name="expiresOn" type="date" label="Vencimento (créditos)" /></FormGrid>
              <Input name="notes" label="Justificativa" required />
              <SubmitButton variant="secondary">Lançar</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
