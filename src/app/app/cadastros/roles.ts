import type { PartyRole } from "@/modules/parties/service";
export const ROLE_PAGES: Record<string, { role: PartyRole; title: string; singular: string; defaults: Record<string, boolean>; dataset: string }> = {
  clientes: { role: "customer", title: "Clientes e prospects", singular: "Cliente", defaults: { isCustomer: true }, dataset: "clientes" },
  fornecedores: { role: "supplier", title: "Fornecedores", singular: "Fornecedor", defaults: { isSupplier: true }, dataset: "fornecedores" },
  parceiros: { role: "partner", title: "Parceiros e canais", singular: "Parceiro", defaults: { isPartner: true }, dataset: "parceiros" },
};
