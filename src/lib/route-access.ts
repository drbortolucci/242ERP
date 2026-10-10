/**
 * Mapa central de acesso às rotas da aplicação (espelha as guardas das páginas e layouts).
 * Usado para não exibir links que levariam a "Acesso não permitido": a guarda da página continua sendo a
 * verificação de segurança; este mapa só decide se o link aparece como link ou como texto.
 * Regras: a primeira regra cujo prefixo casar vale (mais específicas primeiro). Sem regra = rota liberada a qualquer usuário interno.
 */
export interface RouteRule {
  prefix: string;
  /** basta uma das permissões */
  any?: string[];
  module?: string;
}

export const ROUTE_RULES: RouteRule[] = [
  // Comercial
  { prefix: "/app/crm", any: ["crm.read"], module: "crm" },
  { prefix: "/app/propostas", any: ["crm.read"], module: "crm" },
  { prefix: "/app/pedidos", any: ["contract.read"] },
  { prefix: "/app/contratos", any: ["contract.read"] },
  { prefix: "/app/comissoes", any: ["commission.manage"] },
  // Operação
  { prefix: "/app/projetos", any: ["project.read"], module: "projects" },
  { prefix: "/app/recursos", any: ["resource.read"], module: "resources" },
  { prefix: "/app/horas/aprovacao", any: ["time.approve"], module: "timesheet" },
  { prefix: "/app/horas", any: ["time.write", "time.approve"], module: "timesheet" },
  { prefix: "/app/despesas/", any: ["expense.write", "expense.approve", "finance.read"], module: "expenses" },
  { prefix: "/app/despesas", any: ["expense.write", "expense.approve"], module: "expenses" },
  { prefix: "/app/minha-area", any: ["time.write"] },
  // Suprimentos
  { prefix: "/app/suprimentos/requisicoes", any: ["purchase.request", "purchase.write"], module: "procurement" },
  { prefix: "/app/suprimentos/pedidos", any: ["purchase.write", "purchase.approve", "purchase.receive"], module: "procurement" },
  { prefix: "/app/suprimentos/notas", any: ["purchase.write", "finance.read"], module: "procurement" },
  { prefix: "/app/suprimentos/ativos", any: ["purchase.write", "purchase.receive"], module: "procurement" },
  // Estoque
  { prefix: "/app/estoque/vendas", any: ["sales.goods", "inventory.read"], module: "inventory" },
  { prefix: "/app/estoque", any: ["inventory.read"], module: "inventory" },
  // Atendimento recorrente
  { prefix: "/app/ams/saldos", any: ["ams.manage"], module: "ams" },
  { prefix: "/app/ams", any: ["ams.read"], module: "ams" },
  // Faturamento, financeiro e controladoria
  { prefix: "/app/faturamento", any: ["billing.read"], module: "billing" },
  { prefix: "/app/financeiro/conciliacao", any: ["treasury.manage"], module: "finance" },
  { prefix: "/app/financeiro", any: ["finance.read"], module: "finance" },
  { prefix: "/app/controladoria/fechamento", any: ["period.close", "controlling.read"], module: "controlling" },
  { prefix: "/app/controladoria", any: ["controlling.read"], module: "controlling" },
  // Cadastros
  { prefix: "/app/cadastros/importar", any: ["master.write"] },
  { prefix: "/app/cadastros/profissionais", any: ["master.read", "resource.read"] },
  { prefix: "/app/cadastros", any: ["master.read"] },
  // Administração e configuração
  { prefix: "/app/admin/empresas", any: ["company.manage"] },
  { prefix: "/app/admin/usuarios", any: ["users.manage"] },
  { prefix: "/app/admin/perfis", any: ["users.manage"] },
  { prefix: "/app/admin/assinatura", any: ["org.manage"] },
  { prefix: "/app/admin/auditoria", any: ["audit.view"] },
  { prefix: "/app/admin/api", any: ["settings.manage"], module: "api" },
  { prefix: "/app/admin/dados", any: ["data.export", "support.grant"] },
  { prefix: "/app/onboarding", any: ["settings.manage"] },
  { prefix: "/app/config", any: ["settings.manage"] },
];

function matches(path: string, prefix: string) {
  if (prefix.endsWith("/")) return path.startsWith(prefix) && path.length > prefix.length;
  return path === prefix || path.startsWith(prefix + "/");
}

export function routeRule(href: string): RouteRule | undefined {
  const path = href.split(/[?#]/)[0];
  return ROUTE_RULES.find((r) => matches(path, r.prefix));
}

/** O usuário (permissões + módulos efetivos) consegue abrir a rota? */
export function canOpenRoute(href: string, perms: Set<string>, modules: string[]): boolean {
  if (!href.startsWith("/app")) return true;
  const r = routeRule(href);
  if (!r) return true;
  if (r.module && !modules.includes(r.module)) return false;
  if (r.any && !r.any.some((p) => perms.has(p))) return false;
  return true;
}
