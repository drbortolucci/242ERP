/** Datasets exportáveis (CSV/XLSX). Cada um declara a permissão exigida. */
import { registerDataset } from "./service";
import { formatDocument } from "@/lib/documents";

registerDataset("clientes", {
  perms: ["master.read"], title: "Clientes",
  columns: [{ key: "name", label: "Nome" }, { key: "tradeName", label: "Nome fantasia" }, { key: "document", label: "Documento" }, { key: "email", label: "E-mail" }, { key: "phone", label: "Telefone" }, { key: "isCustomer", label: "Cliente" }, { key: "isProspect", label: "Prospect" }, { key: "active", label: "Ativo" }],
  rows: async (ctx) => (await ctx.db.party.findMany({ where: { OR: [{ isCustomer: true }, { isProspect: true }] }, orderBy: { name: "asc" } })).map((p) => ({ ...p, document: formatDocument(p.document) })),
});
registerDataset("fornecedores", {
  perms: ["master.read"], title: "Fornecedores",
  columns: [{ key: "name", label: "Nome" }, { key: "document", label: "Documento" }, { key: "email", label: "E-mail" }, { key: "phone", label: "Telefone" }, { key: "active", label: "Ativo" }],
  rows: async (ctx) => (await ctx.db.party.findMany({ where: { isSupplier: true }, orderBy: { name: "asc" } })).map((p) => ({ ...p, document: formatDocument(p.document) })),
});
registerDataset("parceiros", {
  perms: ["master.read"], title: "Parceiros",
  columns: [{ key: "name", label: "Nome" }, { key: "document", label: "Documento" }, { key: "email", label: "E-mail" }, { key: "active", label: "Ativo" }],
  rows: async (ctx) => (await ctx.db.party.findMany({ where: { isPartner: true }, orderBy: { name: "asc" } })).map((p) => ({ ...p, document: formatDocument(p.document) })),
});
registerDataset("profissionais", {
  perms: ["master.read", "resource.read"], title: "Profissionais",
  columns: [{ key: "name", label: "Nome" }, { key: "email", label: "E-mail" }, { key: "employmentType", label: "Vínculo" }, { key: "capacityPct", label: "Capacidade %" }, { key: "active", label: "Ativo" }],
  rows: async (ctx) => ctx.db.professional.findMany({ orderBy: { name: "asc" } }),
});
registerDataset("auditoria", {
  perms: ["audit.view"], title: "Auditoria",
  columns: [{ key: "createdAt", label: "Data" }, { key: "actorLabel", label: "Usuário" }, { key: "action", label: "Ação" }, { key: "entity", label: "Entidade" }, { key: "entityId", label: "Registro" }, { key: "reason", label: "Justificativa" }, { key: "correlationId", label: "Correlação" }],
  rows: async (ctx) => (await ctx.db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10000 })).map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
});
