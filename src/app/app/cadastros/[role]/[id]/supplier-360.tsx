import Link from "next/link";
import type { Party } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { Card, DefinitionList, Grid, Stat, StatusBadge, Badge, Notice } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionForm, FormGrid, Input, SubmitButton } from "@/components/ui/form";
import { formatDocument } from "@/lib/documents";
import { dec, formatMoney, money, sum } from "@/lib/money";
import { addDays, formatCivil, todayIn, toCivil } from "@/lib/dates";
import { nameMap } from "@/modules/config/lookups";
import { complianceAction } from "@/app/app/suprimentos/actions";
import { poKindLabel } from "@/app/app/suprimentos/constants";

const link = (href: string, label: React.ReactNode) => <Link className="text-brand-700 underline" href={href}>{label}</Link>;

/**
 * Visão 360° do fornecedor: cadastro, documentação/conformidade, serviços e profissionais fornecidos, contratos e pedidos,
 * cotações, projetos atendidos, aceites, documentos de cobrança, contas a pagar, adiantamentos, pendências e avaliações.
 * Valores financeiros só com purchase.write ou finance.read.
 */
export async function Supplier360({ ctx, party }: { ctx: Ctx; party: Party }) {
  const id = party.id;
  const can = (p: string) => ctx.permissions.has(p);
  const canFin = can("purchase.write") || can("finance.read");
  const today = todayIn(ctx.timezone);
  const [contacts, docs, professionals, pos, quotes, invoices, payables, evals] = await Promise.all([
    ctx.db.contact.findMany({ where: { partyId: id, active: true } }),
    ctx.db.supplierComplianceDoc.findMany({ where: { partyId: id }, orderBy: { validUntil: "asc" } }),
    ctx.db.professional.findMany({ where: { supplierPartyId: id } }),
    canFin ? ctx.db.purchaseOrder.findMany({ where: { supplierPartyId: id }, orderBy: { orderDate: "desc" } }) : [],
    canFin ? ctx.db.quotation.findMany({ where: { supplierPartyId: id }, orderBy: { createdAt: "desc" }, take: 20 }) : [],
    canFin ? ctx.db.supplierInvoice.findMany({ where: { supplierPartyId: id }, orderBy: { issueDate: "desc" } }) : [],
    canFin ? ctx.db.payable.findMany({ where: { partyId: id, status: { not: "CANCELED" } }, orderBy: { dueDate: "asc" } }) : [],
    ctx.db.supplierEvaluation.findMany({ where: { partyId: id }, orderBy: { createdAt: "desc" } }),
  ]);
  const poIds = pos.map((p) => p.id);
  const [lines, receipts, skills, allocations, requisitions] = await Promise.all([
    poIds.length ? ctx.db.purchaseOrderLine.findMany({ where: { purchaseOrderId: { in: poIds } } }) : [],
    poIds.length ? ctx.db.goodsReceipt.findMany({ where: { purchaseOrderId: { in: poIds } }, orderBy: { date: "desc" }, take: 20 }) : [],
    professionals.length ? ctx.db.professionalSkill.findMany({ where: { professionalId: { in: professionals.map((p) => p.id) } } }) : [],
    professionals.length && can("project.read") ? ctx.db.allocation.findMany({ where: { professionalId: { in: professionals.map((p) => p.id) }, status: { not: "CANCELED" } } }) : [],
    quotes.length ? ctx.db.purchaseRequisition.findMany({ where: { id: { in: quotes.map((q) => q.requisitionId) } }, select: { id: true, number: true, description: true } }) : [],
  ]);
  const projectIds = [...new Set([...pos.map((p) => p.projectId), ...allocations.map((a) => a.projectId)].filter((x): x is string => !!x))];
  const [projects, skillNames] = await Promise.all([
    projectIds.length ? ctx.db.project.findMany({ where: { id: { in: projectIds } } }) : [],
    skills.length ? ctx.db.skill.findMany({ where: { id: { in: skills.map((s) => s.skillId) } } }) : [],
  ]);
  const poNum = new Map(pos.map((p) => [p.id, p.number]));
  const reqMap = new Map(requisitions.map((r) => [r.id, r]));
  const profNames = await nameMap(ctx, "professional", professionals.map((p) => p.id));
  const skillName = new Map(skillNames.map((s) => [s.id, s.name]));

  const activePos = pos.filter((p) => ["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(p.status));
  const linesOf = (poId: string) => lines.filter((l) => l.purchaseOrderId === poId);
  const commitment = money(sum(activePos.map((p) => dec(p.totalAmount).minus(sum(linesOf(p.id).map((l) => l.invoicedAmount))))));
  const receivedNotInvoiced = money(sum(activePos.map((p) => { const ls = linesOf(p.id); const v = sum(ls.map((l) => l.receivedAmount)).minus(sum(ls.map((l) => l.invoicedAmount))); return v.gt(0) ? v : 0; })));
  const openPayables = payables.filter((p) => ["PENDING_APPROVAL", "OPEN", "PARTIAL"].includes(p.status));
  const overdue = openPayables.filter((p) => toCivil(p.dueDate) < today);
  const advances = payables.filter((p) => p.sourceType === "SUPPLIER_ADVANCE");
  const divergent = invoices.filter((i) => i.status === "DIVERGENT");
  const expiredDocs = docs.filter((d) => d.validUntil && toCivil(d.validUntil) < today);
  const expiringDocs = docs.filter((d) => d.validUntil && toCivil(d.validUntil) >= today && toCivil(d.validUntil) <= addDays(today, 30));
  const avg = (k: "quality" | "deadline" | "price" | "communication") => (evals.length ? (evals.reduce((s, e) => s + e[k], 0) / evals.length).toFixed(1) : "—");
  const overall = evals.length ? (evals.reduce((s, e) => s + (e.quality + e.deadline + e.price + e.communication) / 4, 0) / evals.length).toFixed(1) : "—";
  const pendencias = [
    ...divergent.map((i) => ({ id: `d${i.id}`, text: `Documento ${i.number} divergente`, href: "/app/suprimentos/notas" })),
    ...expiredDocs.map((d) => ({ id: `e${d.id}`, text: `Documento de conformidade vencido: ${d.docType}`, href: "?tab=360" })),
    ...overdue.map((p) => ({ id: `o${p.id}`, text: `Conta a pagar ${p.number} vencida em ${formatCivil(p.dueDate)}`, href: "#" })),
    ...pos.filter((p) => p.status === "PENDING_APPROVAL").map((p) => ({ id: `a${p.id}`, text: `Pedido ${p.number} aguardando aprovação`, href: `/app/suprimentos/pedidos/${p.id}` })),
    ...activePos.filter((p) => p.endDate && toCivil(p.endDate) <= addDays(today, 30)).map((p) => ({ id: `v${p.id}`, text: `Vigência do pedido ${p.number} termina em ${formatCivil(p.endDate)}`, href: `/app/suprimentos/pedidos/${p.id}` })),
  ];
  const back = `/app/cadastros/fornecedores/${id}?tab=360`;

  return (
    <div className="space-y-6">
      {canFin && (
        <Grid cols={5}>
          <Stat label="Compromissos abertos" value={formatMoney(commitment)} hint={`${activePos.length} pedidos ativos`} />
          <Stat label="Aceito não faturado" value={formatMoney(receivedNotInvoiced)} />
          <Stat label="A pagar em aberto" value={formatMoney(sum(openPayables.map((p) => p.openAmount)))} tone={overdue.length ? "bad" : "default"} hint={overdue.length ? `${overdue.length} vencida(s)` : undefined} />
          <Stat label="Adiantamentos" value={formatMoney(sum(advances.map((p) => p.amount)))} />
          <Stat label="Avaliação média" value={overall} hint={`${evals.length} avaliação(ões)`} />
        </Grid>
      )}
      {pendencias.length > 0 && (
        <Card title={`Pendências (${pendencias.length})`}>
          <ul className="list-disc pl-5 text-sm">{pendencias.map((p) => <li key={p.id}>{p.href === "#" ? p.text : link(p.href, p.text)}</li>)}</ul>
        </Card>
      )}
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Cadastro">
          <DefinitionList items={[
            { label: "Documento", value: formatDocument(party.document) }, { label: "Razão social", value: party.name }, { label: "E-mail", value: party.email ?? "—" }, { label: "Telefone", value: party.phone ?? "—" },
            { label: "Papéis", value: <span className="flex flex-wrap gap-1">{party.isSupplier && <Badge>Fornecedor</Badge>}{party.isPartner && <Badge tone="violet">Parceiro</Badge>}{party.isCustomer && <Badge tone="blue">Cliente</Badge>}</span> },
            { label: "Contatos", value: contacts.map((c) => c.name).join(", ") || "—" },
          ]} />
        </Card>
        <Card title="Documentação e conformidade" className="xl:col-span-2">
          {(expiredDocs.length > 0 || expiringDocs.length > 0) && <div className="mb-2"><Notice tone={expiredDocs.length ? "error" : "warn"}>{expiredDocs.length} vencido(s), {expiringDocs.length} vencendo em 30 dias.</Notice></div>}
          <DataTable dense rows={docs} empty="Nenhum documento registrado." columns={[{ key: "docType", label: "Documento" }, { key: "v", label: "Validade", render: (d) => d.validUntil ? <>{formatCivil(d.validUntil)} {toCivil(d.validUntil) < today ? <Badge tone="red">vencido</Badge> : toCivil(d.validUntil) <= addDays(today, 30) ? <Badge tone="amber">a vencer</Badge> : <Badge tone="green">válido</Badge>}</> : "sem validade" }, { key: "notes", label: "Observações", render: (d) => d.notes ?? "" }]} />
          {(can("purchase.write") || can("master.write")) && (
            <div className="mt-3 border-t pt-3">
              <ActionForm action={complianceAction} resetOnSuccess>
                <input type="hidden" name="partyId" value={id} /><input type="hidden" name="back" value={back} />
                <FormGrid cols={3}><Input name="docType" label="Documento (ex.: certidão, contrato social)" required /><Input name="validUntil" type="date" label="Validade" /><Input name="notes" label="Observações" /></FormGrid>
                <SubmitButton variant="secondary">Registrar documento</SubmitButton>
              </ActionForm>
              <p className="mt-1 text-xs text-slate-500">O arquivo comprobatório é anexado na aba Documentos.</p>
            </div>
          )}
        </Card>
      </div>

      <Card title="Profissionais fornecidos e competências">
        <DataTable dense rows={professionals} empty="Nenhum profissional vinculado a este fornecedor." columns={[
          { key: "n", label: "Profissional", render: (p) => link(`/app/cadastros/profissionais/${p.id}`, profNames.get(p.id)) },
          { key: "s", label: "Competências", render: (p) => skills.filter((s) => s.professionalId === p.id).map((s) => skillName.get(s.skillId)).filter(Boolean).join(", ") || "—" },
          { key: "a", label: "Alocações ativas", align: "right", render: (p) => allocations.filter((a) => a.professionalId === p.id).length },
          { key: "st", label: "Situação", render: (p) => <StatusBadge status={p.active ? "ACTIVE" : "INACTIVE"} /> },
        ]} />
      </Card>

      {canFin && (
        <>
          <Card title="Contratos e pedidos de compra">
            <DataTable dense rows={pos} empty="Nenhum pedido." columns={[
              { key: "n", label: "Número", render: (p) => link(`/app/suprimentos/pedidos/${p.id}`, p.number) }, { key: "k", label: "Tipo", render: (p) => poKindLabel(p.kind) },
              { key: "d", label: "Data", render: (p) => formatCivil(p.orderDate) }, { key: "v", label: "Vigência", render: (p) => p.startDate ? `${formatCivil(p.startDate)} a ${formatCivil(p.endDate)}` : "—" },
              { key: "t", label: "Total", align: "right", render: (p) => formatMoney(p.totalAmount) },
              { key: "r", label: "Aceito", align: "right", render: (p) => formatMoney(sum(linesOf(p.id).map((l) => l.receivedAmount))) },
              { key: "i", label: "Faturado", align: "right", render: (p) => formatMoney(sum(linesOf(p.id).map((l) => l.invoicedAmount))) },
              { key: "s", label: "Situação", render: (p) => <StatusBadge status={p.status} /> },
            ]} />
          </Card>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Cotações">
              <DataTable dense rows={quotes} empty="Nenhuma cotação." columns={[
                { key: "r", label: "Requisição", render: (q) => { const r = reqMap.get(q.requisitionId); return r ? link(`/app/suprimentos/requisicoes/${r.id}`, `${r.number} ${r.description}`) : "—"; } },
                { key: "t", label: "Total", align: "right", render: (q) => formatMoney(q.totalAmount) }, { key: "d", label: "Prazo", render: (q) => (q.deliveryDays ?? "—") + " d" },
                { key: "s", label: "Resultado", render: (q) => q.selected ? <Badge tone="green">vencedora</Badge> : <Badge>não selecionada</Badge> },
              ]} />
            </Card>
            <Card title="Projetos atendidos">
              <DataTable dense rows={projects} empty="Nenhum projeto." columns={[
                { key: "p", label: "Projeto", render: (p) => can("project.read") ? link(`/app/projetos/${p.id}`, `${p.code} ${p.name}`) : `${p.code} ${p.name}` },
                { key: "po", label: "Pedidos", align: "right", render: (p) => pos.filter((x) => x.projectId === p.id).length },
                { key: "v", label: "Comprado", align: "right", render: (p) => formatMoney(sum(pos.filter((x) => x.projectId === p.id && x.status !== "CANCELED").map((x) => x.totalAmount))) },
                { key: "s", label: "Situação", render: (p) => <StatusBadge status={p.status} /> },
              ]} />
            </Card>
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Medições e aceites">
              <DataTable dense rows={receipts} empty="Nenhum aceite." columns={[{ key: "number", label: "Número" }, { key: "po", label: "Pedido", render: (r) => link(`/app/suprimentos/pedidos/${r.purchaseOrderId}`, poNum.get(r.purchaseOrderId)) }, { key: "d", label: "Data", render: (r) => formatCivil(r.date) }, { key: "k", label: "Tipo", render: (r) => r.kind === "SERVICE_ACCEPTANCE" ? "Aceite de serviço" : r.kind === "RETURN" ? "Devolução" : "Recebimento" }]} />
            </Card>
            <Card title="Documentos de cobrança">
              <DataTable dense rows={invoices} empty="Nenhum documento." columns={[{ key: "number", label: "Número" }, { key: "po", label: "Pedido", render: (i) => i.purchaseOrderId ? link(`/app/suprimentos/pedidos/${i.purchaseOrderId}`, poNum.get(i.purchaseOrderId)) : "—" }, { key: "d", label: "Emissão", render: (i) => formatCivil(i.issueDate) }, { key: "a", label: "Valor", align: "right", render: (i) => formatMoney(i.amount) }, { key: "s", label: "Situação", render: (i) => <StatusBadge status={i.status} /> }]} />
            </Card>
          </div>
          <Card title="Contas a pagar, adiantamentos e pagamentos">
            <DataTable dense rows={payables} empty="Nenhum título." columns={[
              { key: "number", label: "Número" }, { key: "o", label: "Origem", render: (p) => ({ SUPPLIER_INVOICE: "Documento do fornecedor", SUPPLIER_ADVANCE: "Adiantamento", RECURRING: "Recorrente", MANUAL: "Manual" } as Record<string, string>)[p.sourceType] ?? p.sourceType },
              { key: "desc", label: "Descrição", render: (p) => p.description ?? "" }, { key: "d", label: "Vencimento", render: (p) => <>{formatCivil(p.dueDate)} {["OPEN", "PARTIAL", "PENDING_APPROVAL"].includes(p.status) && toCivil(p.dueDate) < today && <Badge tone="red">vencido</Badge>}</> },
              { key: "a", label: "Valor", align: "right", render: (p) => formatMoney(p.amount) }, { key: "pg", label: "Pago", align: "right", render: (p) => formatMoney(money(dec(p.amount).minus(dec(p.openAmount)))) },
              { key: "ab", label: "Em aberto", align: "right", render: (p) => formatMoney(p.openAmount) }, { key: "s", label: "Situação", render: (p) => <StatusBadge status={p.status} /> },
            ]} />
          </Card>
        </>
      )}

      <Card title="Avaliações">
        {evals.length > 0 && <DefinitionList items={[{ label: "Qualidade", value: avg("quality") }, { label: "Prazo", value: avg("deadline") }, { label: "Preço", value: avg("price") }, { label: "Comunicação", value: avg("communication") }]} />}
        <DataTable dense rows={evals} empty="Nenhuma avaliação (registre a partir de um pedido recebido)." columns={[{ key: "d", label: "Data", render: (e) => e.createdAt.toLocaleDateString("pt-BR", { timeZone: ctx.timezone }) }, { key: "po", label: "Pedido", render: (e) => e.purchaseOrderId ? poNum.get(e.purchaseOrderId) ?? "—" : "—" }, { key: "q", label: "Q/P/$/C", render: (e) => `${e.quality}/${e.deadline}/${e.price}/${e.communication}` }, { key: "c", label: "Comentário", render: (e) => e.comment ?? "" }]} />
      </Card>
    </div>
  );
}
