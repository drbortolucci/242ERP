import { z } from "zod";
import { requirePerm, requireWritable, can, type Ctx } from "@/server/context";
import { audit, diff } from "@/server/audit";
import { conflict, notFound, validation } from "@/lib/errors";
import { zDocument, zEmail, zOptId, zOptStr, zStr, zBool, zArray } from "@/lib/zod-helpers";
import { textSearch, type PageQuery } from "@/lib/query";
import { validateCustomFields } from "../config/custom-fields";

export const partySchema = z.object({
  personType: z.enum(["COMPANY", "PERSON"]).default("COMPANY"),
  name: zStr(2, "Informe o nome/razão social"),
  tradeName: zOptStr,
  document: zDocument,
  email: zEmail,
  phone: zOptStr,
  website: zOptStr,
  street: zOptStr, number: zOptStr, district: zOptStr, city: zOptStr, state: zOptStr, zip: zOptStr,
  isCustomer: zBool, isProspect: zBool, isSupplier: zBool, isPartner: zBool,
  segment: zOptStr,
  ownerUserId: zOptId,
  paymentTermId: zOptId,
  notes: zOptStr,
}).passthrough().refine((p) => p.isCustomer || p.isProspect || p.isSupplier || p.isPartner, { message: "Marque ao menos um papel (cliente, prospect, fornecedor ou parceiro).", path: ["isCustomer"] });
export type PartyInput = z.infer<typeof partySchema>;

function normalizeName(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(ltda|s\/?a|me|eireli|epp)\b/g, "").replace(/[^a-z0-9]/g, "");
}

/** Detecta duplicidade: mesmo documento ou, sem documento, mesmo nome normalizado. */
export async function findDuplicate(ctx: Ctx, i: { name: string; document?: string | null }, exceptId?: string) {
  const not = exceptId ? { NOT: { id: exceptId } } : {};
  if (i.document) {
    const d = await ctx.db.party.findFirst({ where: { document: i.document, ...not } });
    if (d) return d;
  }
  const candidates = await ctx.db.party.findMany({ where: { name: { contains: i.name.slice(0, 4), mode: "insensitive" }, ...not }, take: 200 });
  const n = normalizeName(i.name);
  return candidates.find((c) => normalizeName(c.name) === n && (!i.document || !c.document)) ?? null;
}

function toData(i: PartyInput) {
  return {
    personType: i.personType, name: i.name, tradeName: i.tradeName ?? null, document: i.document ?? null, email: i.email ?? null, phone: i.phone ?? null, website: i.website ?? null,
    address: { street: i.street ?? "", number: i.number ?? "", district: i.district ?? "", city: i.city ?? "", state: i.state ?? "", zip: i.zip ?? "" },
    isCustomer: i.isCustomer, isProspect: i.isProspect && !i.isCustomer, isSupplier: i.isSupplier, isPartner: i.isPartner,
    segment: i.segment ?? null, ownerUserId: i.ownerUserId ?? null, paymentTermId: i.paymentTermId ?? null, notes: i.notes ?? null,
  };
}

export async function createParty(ctx: Ctx, i: PartyInput) {
  requirePerm(ctx, "master.write");
  requireWritable(ctx);
  if (i.document && ((i.personType === "COMPANY" && i.document.length !== 14) || (i.personType === "PERSON" && i.document.length !== 11))) throw validation("Documento incompatível com o tipo de pessoa.");
  const dup = await findDuplicate(ctx, i);
  if (dup) throw conflict(`Possível duplicidade com "${dup.name}". Edite o cadastro existente e marque o papel desejado.`);
  const customFields = await validateCustomFields(ctx, "PARTY", i as Record<string, unknown>);
  const p = await ctx.db.party.create({ data: { organizationId: ctx.orgId, ...toData(i), customFields } });
  await audit(ctx, { action: "party.create", entity: "Party", entityId: p.id, changes: { name: p.name, roles: { customer: p.isCustomer, supplier: p.isSupplier, partner: p.isPartner } } });
  return p;
}

export async function updateParty(ctx: Ctx, id: string, i: PartyInput) {
  requirePerm(ctx, "master.write");
  requireWritable(ctx);
  const before = await ctx.db.party.findFirst({ where: { id } });
  if (!before) throw notFound("Cadastro");
  const dup = await findDuplicate(ctx, i, id);
  if (dup) throw conflict(`Possível duplicidade com "${dup.name}".`);
  const customFields = await validateCustomFields(ctx, "PARTY", i as Record<string, unknown>);
  const after = await ctx.db.party.update({ where: { id }, data: { ...toData(i), customFields } });
  await audit(ctx, { action: "party.update", entity: "Party", entityId: id, changes: diff(before, after) });
  return after;
}

export async function setPartyActive(ctx: Ctx, id: string, active: boolean) {
  requirePerm(ctx, "master.write");
  requireWritable(ctx);
  const p = await ctx.db.party.findFirst({ where: { id } });
  if (!p) throw notFound("Cadastro");
  await ctx.db.party.update({ where: { id }, data: { active } });
  await audit(ctx, { action: active ? "party.activate" : "party.deactivate", entity: "Party", entityId: id });
}

/** Exclusão só é permitida para cadastros sem nenhuma transação vinculada. */
export async function partyUsage(ctx: Ctx, id: string) {
  const where = { partyId: id };
  const counts = await Promise.all([
    ctx.db.opportunity.count({ where }), ctx.db.proposal.count({ where }), ctx.db.contract.count({ where }), ctx.db.project.count({ where }),
    ctx.db.receivable.count({ where }), ctx.db.payable.count({ where }), ctx.db.purchaseOrder.count({ where: { supplierPartyId: id } }), ctx.db.ticket.count({ where }),
  ]);
  return counts.reduce((a, b) => a + b, 0);
}

export async function deleteParty(ctx: Ctx, id: string) {
  requirePerm(ctx, "master.write");
  requireWritable(ctx);
  if ((await partyUsage(ctx, id)) > 0) throw validation("Cadastro utilizado em transações não pode ser excluído. Use a inativação.");
  await ctx.db.contact.deleteMany({ where: { partyId: id } });
  await ctx.db.party.delete({ where: { id } });
  await audit(ctx, { action: "party.delete", entity: "Party", entityId: id });
}

export type PartyRole = "customer" | "supplier" | "partner" | "prospect";
const ROLE_FILTER: Record<PartyRole, object> = {
  customer: { OR: [{ isCustomer: true }, { isProspect: true }] },
  supplier: { isSupplier: true },
  partner: { isPartner: true },
  prospect: { isProspect: true },
};

export async function listParties(ctx: Ctx, role: PartyRole, q: PageQuery, filters: { active?: string; segment?: string } = {}) {
  requirePerm(ctx, "master.read");
  const where = {
    AND: [ROLE_FILTER[role], textSearch(q.q, ["name", "tradeName", "document", "email"]),
      filters.active === "inactive" ? { active: false } : filters.active === "all" ? {} : { active: true },
      filters.segment ? { segment: filters.segment } : {}],
  };
  const [rows, total] = await Promise.all([ctx.db.party.findMany({ where, orderBy: { name: "asc" }, skip: q.skip, take: q.take }), ctx.db.party.count({ where })]);
  return { rows, total };
}

export async function partyOptions(ctx: Ctx, role: PartyRole) {
  const rows = await ctx.db.party.findMany({ where: { ...ROLE_FILTER[role], active: true }, orderBy: { name: "asc" }, take: 1000 });
  return rows.map((p) => ({ value: p.id, label: p.tradeName || p.name }));
}

// ----------------------------------------------------------------- Contatos

export const contactSchema = z.object({
  partyId: z.string().min(1),
  name: zStr(2, "Informe o nome"),
  email: zEmail,
  phone: zOptStr,
  jobTitle: zOptStr,
  roles: zArray,
});

export async function saveContact(ctx: Ctx, id: string | null, i: z.infer<typeof contactSchema>) {
  if (!can(ctx, "master.write") && !can(ctx, "crm.write")) requirePerm(ctx, "master.write");
  requireWritable(ctx);
  if (!(await ctx.db.party.findFirst({ where: { id: i.partyId } }))) throw notFound("Cadastro");
  if (i.email) {
    const dup = await ctx.db.contact.findFirst({ where: { partyId: i.partyId, email: i.email, ...(id ? { NOT: { id } } : {}) } });
    if (dup) throw conflict("Já existe contato com este e-mail para este cadastro.");
  }
  const data = { partyId: i.partyId, name: i.name, email: i.email ?? null, phone: i.phone ?? null, jobTitle: i.jobTitle ?? null, roles: i.roles };
  const c = id ? await ctx.db.contact.update({ where: { id }, data }) : await ctx.db.contact.create({ data: { organizationId: ctx.orgId, ...data } });
  await audit(ctx, { action: id ? "contact.update" : "contact.create", entity: "Contact", entityId: c.id, changes: { name: c.name, roles: c.roles } });
  return c;
}

export const CONTACT_ROLES = [
  { value: "DECISOR", label: "Decisor" }, { value: "SPONSOR", label: "Patrocinador" }, { value: "APROVADOR_HORAS", label: "Aprovador de horas/medições" },
  { value: "FINANCEIRO", label: "Financeiro/cobrança" }, { value: "USUARIO_CHAVE", label: "Usuário-chave" }, { value: "TECNICO", label: "Técnico" }, { value: "COMERCIAL", label: "Comercial" },
];
