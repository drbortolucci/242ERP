import { notFound } from "next/navigation";
import { PageHeader, Card, Tabs, StatusBadge, Badge } from "@/components/ui/page";
import { ActionButton } from "@/components/ui/form";
import { pagePerm } from "@/server/page-guard";
import { requireCtx } from "@/server/auth/next";
import { CONTACT_ROLES, partyUsage } from "@/modules/parties/service";
import { customFieldDefs } from "@/modules/config/custom-fields";
import { Attachments } from "@/components/attachments";
import { prisma } from "@/server/db";
import { formatDocument } from "@/lib/documents";
import { ROLE_PAGES } from "../../roles";
import { PartyForm } from "../../party-form";
import { ContactForm } from "../../contact-form";
import { togglePartyAction, deletePartyAction } from "../../actions";
import { Party360 } from "./party-360";

export default async function PartyPage({ params, searchParams }: { params: Promise<{ role: string; id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { role, id } = await params;
  const cfg = ROLE_PAGES[role];
  if (!cfg) notFound();
  const ctx = await requireCtx();
  pagePerm(ctx, "master.read");
  const party = await ctx.db.party.findFirst({ where: { id } });
  if (!party) notFound();
  const tab = (await searchParams).tab ?? "360";
  const base = `/app/cadastros/${role}/${id}`;
  const canWrite = ctx.permissions.has("master.write");
  return (
    <>
      <PageHeader title={party.tradeName || party.name} subtitle={<span className="flex flex-wrap items-center gap-2">{formatDocument(party.document)} <StatusBadge status={party.active ? "ACTIVE" : "INACTIVE"} />
        {party.isCustomer && <Badge tone="blue">Cliente</Badge>}{party.isProspect && <Badge>Prospect</Badge>}{party.isSupplier && <Badge tone="violet">Fornecedor</Badge>}{party.isPartner && <Badge tone="green">Parceiro</Badge>}</span>}
        breadcrumbs={[{ label: "Cadastros" }, { label: cfg.title, href: `/app/cadastros/${role}` }, { label: party.name }]}
        actions={canWrite && <>
          <ActionButton action={togglePartyAction} fields={{ id, active: party.active ? "false" : "true", back: role }} confirm={party.active ? "Inativar? O histórico é preservado." : undefined}>{party.active ? "Inativar" : "Reativar"}</ActionButton>
          {(await partyUsage(ctx, id)) === 0 && <ActionButton action={deletePartyAction} fields={{ id, back: role }} variant="danger" confirm="Excluir definitivamente este cadastro sem transações?">Excluir</ActionButton>}
        </>} />
      <Tabs active={tab} tabs={[{ key: "360", label: role === "fornecedores" ? "Visão 360° do fornecedor" : role === "clientes" ? "Visão 360° do cliente" : "Resumo", href: `${base}?tab=360` }, { key: "cadastro", label: "Cadastro", href: `${base}?tab=cadastro` }, { key: "contatos", label: "Contatos", href: `${base}?tab=contatos` }, { key: "docs", label: "Documentos", href: `${base}?tab=docs` }]} />
      {tab === "360" && <Party360 ctx={ctx} party={party} role={role} />}
      {tab === "cadastro" && <CadastroTab />}
      {tab === "contatos" && <ContatosTab />}
      {tab === "docs" && <Attachments ctx={ctx} entity="Party" entityId={id} back={`${base}?tab=docs`} canUpload={canWrite} />}
    </>
  );

  async function CadastroTab() {
    const [members, terms, cfs] = await Promise.all([ctx.db.membership.findMany({ where: { kind: "INTERNAL", active: true } }), ctx.db.paymentTerm.findMany({ where: { active: true } }), customFieldDefs(ctx, "PARTY")]);
    const users = await prisma.user.findMany({ where: { id: { in: members.map((m) => m.userId) } }, orderBy: { name: "asc" } });
    return (
      <Card title="Dados cadastrais">
        {canWrite ? <PartyForm party={{ ...party!, address: party!.address as Record<string, string>, customFields: party!.customFields as Record<string, unknown> }} back={role} users={users.map((u) => ({ value: u.id, label: u.name }))} terms={terms.map((t) => ({ value: t.id, label: t.name }))} customFields={cfs} /> : <p className="text-sm">Somente leitura.</p>}
      </Card>
    );
  }

  async function ContatosTab() {
    const contacts = await ctx.db.contact.findMany({ where: { partyId: id }, orderBy: { name: "asc" } });
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Contatos (${contacts.length})`}>
          {contacts.length === 0 ? <p className="text-sm text-slate-500">Nenhum contato.</p> : (
            <ul className="divide-y text-sm">
              {contacts.map((c) => (
                <li key={c.id} className="py-2">
                  <b>{c.name}</b> {c.jobTitle && <span className="text-slate-500">· {c.jobTitle}</span>}
                  <div className="text-xs text-slate-600">{c.email ?? "—"} · {c.phone ?? "—"}</div>
                  <div className="mt-1 flex flex-wrap gap-1">{c.roles.map((r) => <Badge key={r}>{CONTACT_ROLES.find((x) => x.value === r)?.label ?? r}</Badge>)}</div>
                  {canWrite && <details className="mt-1"><summary className="cursor-pointer text-xs text-brand-700">Editar</summary><ContactForm partyId={id} back={role} roles={CONTACT_ROLES} contact={c} /></details>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {canWrite && <Card title="Novo contato"><ContactForm partyId={id} back={role} roles={CONTACT_ROLES} /></Card>}
      </div>
    );
  }
}
