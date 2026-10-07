import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { PageHeader, Card, DefinitionList, StatusBadge, Badge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionButton, ActionForm, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { lookups, nameMap, userNameMap } from "@/modules/config/lookups";
import { formatCivil, todayIn } from "@/lib/dates";
import { dec, formatMoney } from "@/lib/money";
import { settleAction, reverseSettlementAction, approvePayableAction, applyAdvanceAction, reverseApplicationAction, offsetAction, reverseOffsetAction } from "../../../actions";

function originLink(sourceType: string | undefined, sourceId: string | null | undefined, billingDocumentId?: string | null) {
  if (billingDocumentId) return { href: `/app/faturamento/cobrancas/${billingDocumentId}`, label: "Documento de cobrança" };
  if (!sourceType || !sourceId) return null;
  if (sourceType === "SUPPLIER_INVOICE") return { href: "/app/suprimentos/notas", label: "Documento do fornecedor" };
  if (sourceType === "SUPPLIER_ADVANCE") return { href: `/app/suprimentos/pedidos/${sourceId}`, label: "Adiantamento do pedido de compra" };
  if (sourceType.startsWith("EXPENSE")) return { href: `/app/despesas/${sourceId}`, label: "Despesa" };
  return { href: "#", label: sourceType };
}

export default async function TitlePage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind: slug, id } = await params;
  const ctx = await requireCtx();
  pagePerm(ctx, "finance.read");
  if (!["receber", "pagar"].includes(slug)) notFound();
  const kind = slug === "receber" ? "RECEIVABLE" : "PAYABLE";
  const t = kind === "RECEIVABLE" ? await ctx.db.receivable.findFirst({ where: { id } }) : await ctx.db.payable.findFirst({ where: { id } });
  if (!t) notFound();
  const partyId = t.partyId;
  const back = `/app/financeiro/titulos/${slug}/${id}`;
  const [settlements, apps, offsets, banks, advances, counter] = await Promise.all([
    ctx.db.settlement.findMany({ where: kind === "RECEIVABLE" ? { receivableId: id } : { payableId: id }, orderBy: { createdAt: "asc" } }),
    ctx.db.advanceApplication.findMany({ where: kind === "RECEIVABLE" ? { receivableId: id } : { payableId: id } }),
    ctx.db.offset.findMany({ where: kind === "RECEIVABLE" ? { receivableId: id } : { payableId: id } }),
    ctx.db.bankAccount.findMany({ where: { companyId: t.companyId, active: true } }),
    partyId ? ctx.db.advance.findMany({ where: { partyId, direction: kind === "RECEIVABLE" ? "CUSTOMER" : "SUPPLIER", status: "OPEN" } }) : [],
    partyId ? (kind === "RECEIVABLE" ? ctx.db.payable.findMany({ where: { partyId, companyId: t.companyId, status: { in: ["OPEN", "PARTIAL"] } } }) : ctx.db.receivable.findMany({ where: { partyId, companyId: t.companyId, status: { in: ["OPEN", "PARTIAL"] } } })) : [],
  ]);
  const [pn, users, accs] = await Promise.all([nameMap(ctx, "party", [partyId]), userNameMap(settlements.map((s) => s.createdById)), lookups.bankAccounts(ctx)]);
  const accName = new Map(accs.map((a) => [a.value, a.label]));
  const open = dec(t.openAmount);
  const can = (p: string) => ctx.permissions.has(p);
  const p = t as { sourceType?: string; sourceId?: string | null; billingDocumentId?: string | null; approvedById?: string | null };
  const origin = originLink(p.sourceType, p.sourceId, p.billingDocumentId);
  const settleable = ["OPEN", "PARTIAL"].includes(t.status) && can("payment.register");
  return (
    <>
      <PageHeader title={`${kind === "RECEIVABLE" ? "Título a receber" : "Título a pagar"} ${t.number}`} subtitle={<StatusBadge status={t.status} />} breadcrumbs={[{ label: kind === "RECEIVABLE" ? "Contas a receber" : "Contas a pagar", href: `/app/financeiro/${slug}` }, { label: t.number }]}
        actions={kind === "PAYABLE" && t.status === "PENDING_APPROVAL" && can("payable.approve") && <ActionButton action={approvePayableAction} fields={{ id }} variant="primary">Aprovar pagamento</ActionButton>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Liquidações">
            <DataTable dense rows={settlements} empty="Nenhuma liquidação." columns={[
              { key: "d", label: "Data", render: (s) => formatCivil(s.date) }, { key: "p", label: "Principal", align: "right", render: (s) => formatMoney(s.principal) },
              { key: "j", label: "Juros/multa", align: "right", render: (s) => formatMoney(dec(s.interest).plus(s.fine)) }, { key: "x", label: "Desconto", align: "right", render: (s) => formatMoney(s.discount) },
              { key: "t", label: "Total", align: "right", render: (s) => formatMoney(s.total) }, { key: "b", label: "Conta", render: (s) => accName.get(s.bankAccountId) ?? "—" },
              { key: "s", label: "Situação", render: (s) => s.reversalOfId ? <Badge tone="red">estorno</Badge> : <StatusBadge status={s.status === "REVERSED" ? "REVERSED" : "POSTED"} /> },
              { key: "u", label: "Por", render: (s) => users.get(s.createdById) },
              { key: "r", label: "", render: (s) => !s.reversalOfId && s.status === "POSTED" && can("payment.reverse") ? <ActionForm action={reverseSettlementAction} className="flex items-end gap-1"><input type="hidden" name="id" value={s.id} /><input type="hidden" name="kind" value={kind} /><input type="hidden" name="titleId" value={id} /><Input name="reason" aria-label="Motivo do estorno" placeholder="Motivo" required /><SubmitButton variant="danger" confirm="Estornar a liquidação?">Estornar</SubmitButton></ActionForm> : s.reversalReason ?? null },
            ]} />
            {settleable && (
              <ActionForm action={settleAction} resetOnSuccess className="mt-4 border-t pt-4">
                <input type="hidden" name="kind" value={kind} /><input type="hidden" name="titleId" value={id} /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
                <FormGrid cols={3}><Input name="date" type="date" label="Data" defaultValue={todayIn(ctx.timezone)} required /><Input name="principal" label="Principal" defaultValue={open.toFixed(2)} required /><Select name="bankAccountId" label="Conta bancária" options={banks.map((b) => ({ value: b.id, label: b.name }))} required /></FormGrid>
                <FormGrid cols={3}><Input name="interest" label="Juros" defaultValue="0" /><Input name="fine" label="Multa" defaultValue="0" /><Input name="discount" label="Desconto" defaultValue="0" /></FormGrid>
                <SubmitButton>{kind === "RECEIVABLE" ? "Registrar recebimento" : "Registrar pagamento"}</SubmitButton>
              </ActionForm>
            )}
          </Card>
          <Card title="Adiantamentos aplicados">
            <DataTable dense rows={apps} empty="Nenhum." columns={[{ key: "a", label: "Valor", align: "right", render: (a) => formatMoney(a.amount) }, { key: "s", label: "Situação", render: (a) => <StatusBadge status={a.status} /> }, { key: "r", label: "", render: (a) => a.status === "POSTED" && can("payment.reverse") ? <ActionForm action={reverseApplicationAction} className="flex items-end gap-1"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="kind" value={kind} /><input type="hidden" name="titleId" value={id} /><Input name="reason" aria-label="Motivo" placeholder="Motivo" required /><SubmitButton variant="danger">Estornar</SubmitButton></ActionForm> : null }]} />
            {settleable && advances.length > 0 && (
              <ActionForm action={applyAdvanceAction} className="mt-3 border-t pt-3">
                <input type="hidden" name="titleId" value={id} /><input type="hidden" name="kind" value={kind} />
                <FormGrid cols={2}><Select name="advanceId" label="Adiantamento" options={advances.map((a) => ({ value: a.id, label: `${formatCivil(a.date)} — saldo ${formatMoney(dec(a.amount).minus(a.appliedAmount))}` }))} /><Input name="amount" label="Valor a aplicar" required /></FormGrid>
                <SubmitButton variant="secondary">Aplicar adiantamento</SubmitButton>
              </ActionForm>
            )}
          </Card>
          <Card title="Compensações">
            <DataTable dense rows={offsets} empty="Nenhuma." columns={[{ key: "a", label: "Valor", align: "right", render: (o) => formatMoney(o.amount) }, { key: "reason", label: "Motivo" }, { key: "s", label: "Situação", render: (o) => <StatusBadge status={o.status} /> }, { key: "r", label: "", render: (o) => o.status === "POSTED" && can("offset.approve") ? <ActionForm action={reverseOffsetAction} className="flex items-end gap-1"><input type="hidden" name="id" value={o.id} /><input type="hidden" name="back" value={back} /><Input name="reason" aria-label="Motivo" placeholder="Motivo" required /><SubmitButton variant="danger">Estornar</SubmitButton></ActionForm> : null }]} />
            {can("offset.approve") && ["OPEN", "PARTIAL"].includes(t.status) && counter.length > 0 && (
              <ActionForm action={offsetAction} className="mt-3 border-t pt-3">
                <input type="hidden" name="back" value={back} />
                {kind === "RECEIVABLE" ? <input type="hidden" name="receivableId" value={id} /> : <input type="hidden" name="payableId" value={id} />}
                <FormGrid cols={3}><Select name={kind === "RECEIVABLE" ? "payableId" : "receivableId"} label={kind === "RECEIVABLE" ? "Conta a pagar da mesma parte" : "Conta a receber da mesma parte"} options={counter.map((c) => ({ value: c.id, label: `${c.number} — ${formatMoney(c.openAmount)}` }))} /><Input name="amount" label="Valor" required /><Input name="reason" label="Motivo/autorização" required /></FormGrid>
                <SubmitButton variant="secondary">Compensar</SubmitButton>
              </ActionForm>
            )}
          </Card>
        </div>
        <Card title="Dados">
          <DefinitionList items={[
            { label: kind === "RECEIVABLE" ? "Cliente" : "Fornecedor", value: partyId ? <Link className="text-brand-700 underline" href={`/app/cadastros/${kind === "RECEIVABLE" ? "clientes" : "fornecedores"}/${partyId}`}>{pn.get(partyId)}</Link> : "—" },
            { label: "Descrição", value: t.description ?? "—" }, { label: "Origem", value: origin ? <Link className="text-brand-700 underline" href={origin.href}>{origin.label}</Link> : "Manual" },
            { label: "Emissão", value: formatCivil(t.issueDate) }, { label: "Vencimento", value: formatCivil(t.dueDate) }, { label: "Competência", value: formatCivil(t.competence).slice(3) },
            { label: "Valor", value: formatMoney(t.amount) }, { label: "Em aberto", value: <b>{formatMoney(t.openAmount)}</b> },
            ...(kind === "PAYABLE" ? [{ label: "Aprovado por", value: p.approvedById ? "registrado na auditoria" : "pendente" }] : []),
          ]} />
        </Card>
      </div>
    </>
  );
}
