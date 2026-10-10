import Link from "@/components/ui/access-link";
import { PageHeader, Card, StatusBadge, Stat, Grid, Badge } from "@/components/ui/page";
import { DataTable, Pagination, Toolbar } from "@/components/ui/table";
import { ActionForm, Select, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pageAnyPerm } from "@/server/page-guard";
import { lookups, nameMap, userNameMap } from "@/modules/config/lookups";
import { pageQuery, sp, textSearch, type SearchParams } from "@/lib/query";
import { addDays, civil, formatCivil, todayIn, toCivil } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { statusLabel } from "@/lib/labels";
import { assetMoveAction } from "../actions";

const KIND = { LICENSE: "Licença", SUBSCRIPTION: "Assinatura", EQUIPMENT: "Equipamento", MATERIAL: "Material" } as Record<string, string>;

export const metadata = { title: "Ativos e licenças" };
export default async function AssetsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await searchParams;
  const ctx = await requireCtx();
  pageAnyPerm(ctx, "purchase.write", "purchase.receive");
  const q = pageQuery(s);
  const kind = sp(s, "kind");
  const status = sp(s, "status");
  const today = todayIn(ctx.timezone);
  const in60 = civil(addDays(today, 60));
  const where = { AND: [textSearch(q.q, ["name", "serialNumber"]), kind ? { kind } : {}, status ? { status } : {}] };
  const [rows, total, renewals, professionals, moves] = await Promise.all([
    ctx.db.asset.findMany({ where, orderBy: { name: "asc" }, skip: q.skip, take: q.take }), ctx.db.asset.count({ where }),
    ctx.db.asset.findMany({ where: { renewalDate: { lte: in60 }, status: { not: "RETIRED" } }, orderBy: { renewalDate: "asc" } }),
    lookups.professionals(ctx), ctx.db.assetMovement.findMany({ orderBy: { createdAt: "desc" }, take: 15 }),
  ]);
  const [sn, prof, users, assetNames] = await Promise.all([
    nameMap(ctx, "party", rows.map((r) => r.supplierPartyId)), nameMap(ctx, "professional", [...rows.map((r) => r.assignedProfessionalId), ...moves.map((m) => m.professionalId)]),
    userNameMap(moves.map((m) => m.createdById)), ctx.db.asset.findMany({ where: { id: { in: moves.map((m) => m.assetId) } }, select: { id: true, name: true } }),
  ]);
  const an = new Map(assetNames.map((a) => [a.id, a.name]));
  const canMove = ctx.permissions.has("purchase.write") || ctx.permissions.has("purchase.receive");
  const expired = renewals.filter((a) => toCivil(a.renewalDate!) < today).length;
  return (
    <>
      <PageHeader title="Ativos, licenças e materiais" breadcrumbs={[{ label: "Suprimentos" }, { label: "Ativos" }]} />
      <Grid cols={3}>
        <Stat label="Itens cadastrados" value={total} />
        <Stat label="Renovações nos próximos 60 dias" value={renewals.length - expired} tone={renewals.length - expired ? "warn" : "default"} />
        <Stat label="Vencidos sem renovação" value={expired} tone={expired ? "bad" : "default"} />
      </Grid>
      {renewals.length > 0 && (
        <Card title="Alertas de renovação" className="mt-6">
          <DataTable dense rows={renewals} columns={[{ key: "name", label: "Item" }, { key: "k", label: "Tipo", render: (a) => KIND[a.kind] ?? a.kind }, { key: "r", label: "Renovação", render: (a) => <>{formatCivil(a.renewalDate)} {toCivil(a.renewalDate!) < today ? <Badge tone="red">vencido</Badge> : <Badge tone="amber">a vencer</Badge>}</> }, { key: "c", label: "Custo", align: "right", render: (a) => formatMoney(a.cost) }, { key: "po", label: "Pedido", render: (a) => a.purchaseOrderId ? <Link className="text-brand-700 underline" href={`/app/suprimentos/pedidos/${a.purchaseOrderId}`}>abrir</Link> : "—" }]} />
        </Card>
      )}
      <div className="mt-6">
        <Toolbar base="/app/suprimentos/ativos" params={s} filters={[{ name: "kind", label: "Tipo", options: Object.entries(KIND).map(([value, label]) => ({ value, label })) }, { name: "status", label: "Situação", options: ["ACTIVE", "IN_STOCK", "ASSIGNED", "RETIRED", "EXPIRED"].map((v) => ({ value: v, label: statusLabel(v) })) }]} />
        <DataTable rows={rows} columns={[
          { key: "name", label: "Item", render: (a) => <>{a.name}{a.serialNumber && <span className="text-xs text-slate-500"> · {a.serialNumber}</span>}</> },
          { key: "k", label: "Tipo", render: (a) => KIND[a.kind] ?? a.kind }, { key: "q", label: "Qtd.", align: "right", render: (a) => formatQty(a.quantity) },
          { key: "c", label: "Custo", align: "right", render: (a) => formatMoney(a.cost) }, { key: "s", label: "Fornecedor", render: (a) => sn.get(a.supplierPartyId ?? "") ?? "—" },
          { key: "p", label: "Com", render: (a) => prof.get(a.assignedProfessionalId ?? "") ?? "—" }, { key: "r", label: "Renovação", render: (a) => formatCivil(a.renewalDate) },
          { key: "st", label: "Situação", render: (a) => <StatusBadge status={a.status} /> },
          { key: "m", label: "Movimentar", render: (a) => canMove && a.status !== "RETIRED" ? (
            <ActionForm action={assetMoveAction} className="flex flex-wrap items-end gap-1">
              <input type="hidden" name="assetId" value={a.id} />
              <Select name="kind" aria-label="Movimento" options={a.status === "ASSIGNED" ? [{ value: "RETURN", label: "Devolver" }, { value: "RETIRE", label: "Baixar" }] : [{ value: "ASSIGN", label: "Entregar a" }, { value: "RETIRE", label: "Baixar" }]} />
              {a.status !== "ASSIGNED" && <Select name="professionalId" aria-label="Profissional" options={professionals} placeholder="—" />}
              <SubmitButton variant="secondary">OK</SubmitButton>
            </ActionForm>) : null },
        ]} />
        <Pagination base="/app/suprimentos/ativos" params={s} page={q.page} pageSize={q.pageSize} total={total} />
      </div>
      <Card title="Últimas movimentações" className="mt-6">
        <DataTable dense rows={moves} empty="Nenhuma movimentação." columns={[{ key: "d", label: "Quando", render: (m) => m.createdAt.toLocaleString("pt-BR", { timeZone: ctx.timezone }) }, { key: "a", label: "Item", render: (m) => an.get(m.assetId) }, { key: "kind", label: "Movimento", render: (m) => ({ IN: "Entrada", ASSIGN: "Entrega", RETURN: "Devolução", RETIRE: "Baixa" } as Record<string, string>)[m.kind] ?? m.kind }, { key: "p", label: "Profissional", render: (m) => prof.get(m.professionalId ?? "") ?? "—" }, { key: "u", label: "Por", render: (m) => users.get(m.createdById) }]} />
      </Card>
      <p className="mt-4 text-xs text-slate-500">Itens dos tipos licença, assinatura, equipamento e material são cadastrados automaticamente no recebimento do pedido de compra.</p>
    </>
  );
}
