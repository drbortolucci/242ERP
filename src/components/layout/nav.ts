import type { Permission } from "@/lib/permissions";

export interface NavItem {
  label: string;
  href: string;
  perm?: Permission | Permission[];
  module?: string;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { label: "Início", items: [{ label: "Painel", href: "/app" }, { label: "Minha área", href: "/app/minha-area", perm: "time.write" }, { label: "Aprovações", href: "/app/aprovacoes" }] },
  {
    label: "Comercial",
    items: [
      { label: "Leads", href: "/app/crm/leads", perm: "crm.read", module: "crm" },
      { label: "Oportunidades", href: "/app/crm/oportunidades", perm: "crm.read", module: "crm" },
      { label: "Atividades", href: "/app/crm/atividades", perm: "crm.read", module: "crm" },
      { label: "Propostas", href: "/app/propostas", perm: "crm.read", module: "crm" },
      { label: "Pedidos de venda", href: "/app/pedidos", perm: "contract.read" },
      { label: "Contratos", href: "/app/contratos", perm: "contract.read" },
      { label: "Comissões", href: "/app/comissoes", perm: "commission.manage" },
    ],
  },
  {
    label: "Operação",
    items: [
      { label: "Projetos", href: "/app/projetos", perm: "project.read", module: "projects" },
      { label: "Portfólio", href: "/app/projetos/portfolio", perm: "project.read", module: "projects" },
      { label: "Recursos e alocação", href: "/app/recursos", perm: "resource.read", module: "resources" },
      { label: "Horas", href: "/app/horas", perm: ["time.write", "time.approve"], module: "timesheet" },
      { label: "Despesas", href: "/app/despesas", perm: ["expense.write", "expense.approve"], module: "expenses" },
    ],
  },
  {
    label: "Suprimentos",
    items: [
      { label: "Requisições", href: "/app/suprimentos/requisicoes", perm: ["purchase.request", "purchase.write"], module: "procurement" },
      { label: "Pedidos de compra", href: "/app/suprimentos/pedidos", perm: ["purchase.write", "purchase.approve", "purchase.receive"], module: "procurement" },
      { label: "Documentos de fornecedor", href: "/app/suprimentos/notas", perm: ["purchase.write", "finance.read"], module: "procurement" },
      { label: "Ativos e licenças", href: "/app/suprimentos/ativos", perm: ["purchase.write"], module: "procurement" },
    ],
  },
  {
    label: "AMS",
    items: [
      { label: "Chamados", href: "/app/ams/chamados", perm: "ams.read", module: "ams" },
      { label: "Saldos e franquias", href: "/app/ams/saldos", perm: "ams.manage", module: "ams" },
      { label: "Base de conhecimento", href: "/app/ams/conhecimento", perm: "ams.read", module: "ams" },
    ],
  },
  {
    label: "Faturamento",
    items: [
      { label: "Pendências a faturar", href: "/app/faturamento/pendencias", perm: "billing.read", module: "billing" },
      { label: "Medições", href: "/app/faturamento/medicoes", perm: "billing.read", module: "billing" },
      { label: "Documentos de cobrança", href: "/app/faturamento/cobrancas", perm: "billing.read", module: "billing" },
    ],
  },
  {
    label: "Financeiro",
    items: [
      { label: "Contas a receber", href: "/app/financeiro/receber", perm: "finance.read", module: "finance" },
      { label: "Contas a pagar", href: "/app/financeiro/pagar", perm: "finance.read", module: "finance" },
      { label: "Adiantamentos", href: "/app/financeiro/adiantamentos", perm: "finance.read", module: "finance" },
      { label: "Tesouraria", href: "/app/financeiro/tesouraria", perm: "finance.read", module: "finance" },
      { label: "Conciliação", href: "/app/financeiro/conciliacao", perm: "treasury.manage", module: "finance" },
      { label: "Fluxo de caixa", href: "/app/financeiro/fluxo-caixa", perm: "finance.read", module: "finance" },
    ],
  },
  {
    label: "Controladoria",
    items: [
      { label: "DRE gerencial", href: "/app/controladoria/dre", perm: "controlling.read", module: "controlling" },
      { label: "P&L de projetos", href: "/app/controladoria/pl", perm: ["controlling.read", "margin.view"], module: "controlling" },
      { label: "Orçamentos", href: "/app/controladoria/orcamentos", perm: "controlling.read", module: "controlling" },
      { label: "Rateios", href: "/app/controladoria/rateios", perm: "controlling.read", module: "controlling" },
      { label: "Razão gerencial", href: "/app/controladoria/razao", perm: "controlling.read", module: "controlling" },
      { label: "Fechamento", href: "/app/controladoria/fechamento", perm: ["period.close", "controlling.read"], module: "controlling" },
    ],
  },
  {
    label: "Cadastros",
    items: [
      { label: "Clientes e prospects", href: "/app/cadastros/clientes", perm: "master.read" },
      { label: "Fornecedores", href: "/app/cadastros/fornecedores", perm: "master.read" },
      { label: "Parceiros", href: "/app/cadastros/parceiros", perm: "master.read" },
      { label: "Profissionais", href: "/app/cadastros/profissionais", perm: ["master.read", "resource.read"] },
      { label: "Serviços", href: "/app/cadastros/servicos", perm: "master.read" },
      { label: "Importar planilha", href: "/app/cadastros/importar", perm: "master.write" },
    ],
  },
  {
    label: "Administração",
    items: [
      { label: "Empresas", href: "/app/admin/empresas", perm: "company.manage" },
      { label: "Configurador", href: "/app/config", perm: "settings.manage" },
      { label: "Usuários e perfis", href: "/app/admin/usuarios", perm: "users.manage" },
      { label: "Assinatura e plano", href: "/app/admin/assinatura", perm: "org.manage" },
      { label: "Auditoria", href: "/app/admin/auditoria", perm: "audit.view" },
      { label: "Privacidade e dados", href: "/app/admin/dados", perm: ["data.export", "support.grant"] },
    ],
  },
];

export function visibleNav(perms: Set<string>, modules: string[]): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => {
      if (i.module && !modules.includes(i.module)) return false;
      if (!i.perm) return true;
      const ps = Array.isArray(i.perm) ? i.perm : [i.perm];
      return ps.some((p) => perms.has(p));
    }),
  })).filter((g) => g.items.length > 0);
}
