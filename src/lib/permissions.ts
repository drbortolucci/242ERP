/**
 * Catálogo de permissões (ação + módulo) e perfis padrão.
 * O escopo de dados (empresas, cliente do portal) é aplicado separadamente pelo contexto do tenant.
 * Toda verificação é feita no servidor; a interface apenas reflete o resultado.
 */
export const PERMISSIONS = {
  // Administração
  "org.manage": "Administrar organização, plano e assinatura",
  "users.manage": "Gerenciar usuários, convites e perfis",
  "settings.manage": "Alterar configurações e cadastros de configuração",
  "company.manage": "Criar e configurar empresas",
  "audit.view": "Consultar auditoria",
  "data.export": "Exportar dados",
  "support.grant": "Autorizar acesso temporário de suporte",
  // Cadastros
  "master.read": "Consultar cadastros",
  "master.write": "Manter cadastros (clientes, fornecedores, profissionais)",
  // Sigilo
  "cost.view": "Ver custos e remuneração",
  "margin.view": "Ver margens e resultado",
  "cost.manage": "Alterar custos/hora e tarifas",
  // CRM e vendas
  "crm.read": "Consultar CRM",
  "crm.write": "Manter leads, oportunidades e atividades",
  "proposal.write": "Elaborar propostas",
  "proposal.approve": "Aprovar propostas (descontos/margens dentro da alçada)",
  "proposal.approve_high": "Aprovar propostas acima da alçada padrão",
  "contract.read": "Consultar contratos",
  "contract.write": "Manter pedidos, contratos e aditivos",
  "contract.approve": "Aprovar aditivos e exceções contratuais",
  "commission.manage": "Gerir comissões",
  // Operação
  "project.read": "Consultar projetos",
  "project.write": "Manter projetos, WBS, riscos e status",
  "project.baseline": "Aprovar linhas de base de projetos",
  "resource.read": "Consultar recursos e alocações",
  "resource.write": "Planejar recursos e alocações",
  "resource.override": "Autorizar alocação com conflito",
  "time.write": "Apontar horas próprias",
  "time.write_any": "Apontar horas para outros profissionais",
  "time.approve": "Aprovar horas",
  "expense.write": "Lançar despesas",
  "expense.approve": "Aprovar despesas",
  // Suprimentos
  "purchase.request": "Criar requisições de compra",
  "purchase.write": "Cotações e pedidos de compra",
  "purchase.approve": "Aprovar compras",
  "purchase.receive": "Registrar recebimentos e aceites",
  // AMS
  "ams.read": "Consultar chamados",
  "ams.write": "Atender chamados",
  "ams.manage": "Gerir contratos AMS, SLA e saldos",
  // Estoque e vendas de produtos
  "inventory.read": "Consultar produtos, saldos e movimentos de estoque",
  "inventory.write": "Manter produtos, depósitos e transferências",
  "inventory.adjust": "Ajustes, consumo, saldo inicial e inventário de estoque",
  "sales.goods": "Pedidos de venda de produtos (confirmar, entregar, cancelar)",
  // Faturamento e financeiro
  "billing.read": "Consultar medições e faturamento",
  "billing.measure": "Gerar medições",
  "billing.approve": "Aprovar medições",
  "billing.issue": "Emitir documentos de cobrança",
  "billing.cancel": "Cancelar documentos de cobrança",
  "finance.read": "Consultar financeiro",
  "finance.write": "Manter títulos a receber e a pagar",
  "payable.approve": "Aprovar contas a pagar",
  "payment.register": "Registrar recebimentos e pagamentos",
  "payment.reverse": "Estornar liquidações",
  "treasury.manage": "Tesouraria, transferências e conciliação",
  "offset.approve": "Autorizar compensações cliente/fornecedor",
  // Controladoria
  "controlling.read": "Consultar controladoria e DRE",
  "controlling.write": "Orçamentos, rateios e ajustes gerenciais",
  "period.close": "Fechar períodos",
  "period.reopen": "Reabrir períodos",
  // Portal do cliente
  "portal.access": "Acessar portal do cliente",
  "portal.approve": "Aprovar horas/medições/entregáveis no portal",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const P = (...p: Permission[]) => p;

const READ_OPS = P("master.read", "crm.read", "contract.read", "project.read", "resource.read", "ams.read", "billing.read", "finance.read", "controlling.read", "inventory.read");

/** Perfis padrão (copiados para cada organização e editáveis). */
export const ROLE_TEMPLATES: { key: string; name: string; description: string; permissions: Permission[] }[] = [
  { key: "org_admin", name: "Administrador da organização", description: "Acesso total à organização", permissions: ALL_PERMISSIONS.filter((p) => !p.startsWith("portal.")) },
  {
    key: "company_admin", name: "Administrador da empresa", description: "Configura empresa(s) do seu escopo",
    permissions: P("settings.manage", "company.manage", "users.manage", "audit.view", "master.read", "master.write", ...READ_OPS),
  },
  {
    key: "director", name: "Sócio/Diretor", description: "Visão de negócio, caixa, margens e riscos",
    permissions: P(...READ_OPS, "cost.view", "margin.view", "proposal.approve", "proposal.approve_high", "contract.approve", "purchase.approve", "payable.approve", "offset.approve", "audit.view", "data.export", "project.baseline"),
  },
  {
    key: "sales", name: "Comercial", description: "CRM, propostas e pedidos",
    permissions: P("master.read", "master.write", "crm.read", "crm.write", "proposal.write", "contract.read", "contract.write", "project.read", "ams.read", "billing.read", "margin.view", "inventory.read", "sales.goods"),
  },
  {
    key: "pmo", name: "Gestor de projetos/PMO", description: "Projetos, recursos, horas e medições",
    permissions: P("master.read", "crm.read", "contract.read", "project.read", "project.write", "project.baseline", "resource.read", "resource.write", "time.write", "time.write_any", "time.approve", "expense.write", "expense.approve", "purchase.request", "purchase.receive", "billing.read", "billing.measure", "margin.view", "ams.read"),
  },
  {
    key: "ams_manager", name: "Gestor de AMS", description: "Chamados, SLA e franquias",
    permissions: P("master.read", "contract.read", "ams.read", "ams.write", "ams.manage", "time.write", "time.approve", "billing.read", "billing.measure", "resource.read", "project.read"),
  },
  {
    key: "resource_manager", name: "Gestor de recursos", description: "Capacidade, alocações e profissionais",
    permissions: P("master.read", "master.write", "project.read", "resource.read", "resource.write", "resource.override", "time.approve"),
  },
  {
    key: "finance", name: "Financeiro", description: "Faturamento, títulos, tesouraria e conciliação",
    permissions: P(...READ_OPS, "billing.measure", "billing.approve", "billing.issue", "billing.cancel", "finance.write", "payment.register", "payment.reverse", "treasury.manage", "data.export"),
  },
  {
    key: "controller", name: "Controladoria", description: "Orçamento, P&L, rateios e fechamento",
    permissions: P(...READ_OPS, "cost.view", "margin.view", "controlling.write", "period.close", "period.reopen", "data.export", "audit.view"),
  },
  {
    key: "purchasing", name: "Compras", description: "Requisições, cotações, pedidos e aceites",
    permissions: P("master.read", "master.write", "project.read", "purchase.request", "purchase.write", "purchase.receive", "finance.read", "inventory.read", "inventory.write"),
  },
  {
    key: "stock_keeper", name: "Estoque e expedição", description: "Produtos, depósitos, recebimentos, inventário e entregas",
    permissions: P("master.read", "inventory.read", "inventory.write", "inventory.adjust", "purchase.receive", "sales.goods", "project.read"),
  },
  {
    key: "consultant", name: "Profissional (operação)", description: "Minha área: horas, despesas, chamados e atividades",
    permissions: P("time.write", "expense.write", "ams.read", "ams.write", "project.read", "purchase.request"),
  },
  {
    key: "client_approver", name: "Aprovador do cliente", description: "Portal do cliente com aprovações",
    permissions: P("portal.access", "portal.approve"),
  },
  {
    key: "client_user", name: "Cliente (portal)", description: "Portal do cliente: chamados e consultas",
    permissions: P("portal.access"),
  },
];

export function isPermission(p: string): p is Permission {
  return p in PERMISSIONS;
}
