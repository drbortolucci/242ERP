/**
 * Plano de contas contábil SUGERIDO (estrutura simplificada para empresas de serviços e comércio).
 * É ponto de partida: o contador responsável revisa, ajusta códigos/nomes, cria subcontas e informa o código do plano
 * referencial (SPED). As chaves de sistema (systemKey) indicam onde os lançamentos automáticos são feitos.
 */
export type Nature = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export interface ChartAccount { code: string; name: string; nature: Nature; analytic: boolean; systemKey?: string }

export const SUGGESTED_CHART: ChartAccount[] = [
  { code: "1", name: "Ativo", nature: "ASSET", analytic: false },
  { code: "1.1", name: "Ativo circulante", nature: "ASSET", analytic: false },
  { code: "1.1.1", name: "Disponível", nature: "ASSET", analytic: false },
  { code: "1.1.1.01", name: "Caixa", nature: "ASSET", analytic: true, systemKey: "CASH" },
  { code: "1.1.1.02", name: "Bancos conta movimento", nature: "ASSET", analytic: true, systemKey: "BANKS" },
  { code: "1.1.2", name: "Créditos", nature: "ASSET", analytic: false },
  { code: "1.1.2.01", name: "Clientes", nature: "ASSET", analytic: true, systemKey: "RECEIVABLES" },
  { code: "1.1.2.02", name: "Adiantamentos a fornecedores e profissionais", nature: "ASSET", analytic: true, systemKey: "SUPPLIER_ADVANCES" },
  { code: "1.1.2.03", name: "Tributos retidos por clientes a compensar", nature: "ASSET", analytic: true, systemKey: "WITHHELD_TAXES" },
  { code: "1.1.3", name: "Estoques", nature: "ASSET", analytic: false },
  { code: "1.1.3.01", name: "Mercadorias e materiais", nature: "ASSET", analytic: true, systemKey: "INVENTORY" },
  { code: "2", name: "Passivo", nature: "LIABILITY", analytic: false },
  { code: "2.1", name: "Passivo circulante", nature: "LIABILITY", analytic: false },
  { code: "2.1.1.01", name: "Fornecedores e contas a pagar", nature: "LIABILITY", analytic: true, systemKey: "PAYABLES" },
  { code: "2.1.1.02", name: "Mercadorias recebidas a faturar", nature: "LIABILITY", analytic: true, systemKey: "GRNI" },
  { code: "2.1.1.03", name: "Adiantamentos de clientes", nature: "LIABILITY", analytic: true, systemKey: "CUSTOMER_ADVANCES" },
  { code: "2.1.1.04", name: "Obrigações com pessoal", nature: "LIABILITY", analytic: true, systemKey: "PAYROLL_PAYABLE" },
  { code: "2.3", name: "Patrimônio líquido", nature: "EQUITY", analytic: false },
  { code: "2.3.1", name: "Capital social", nature: "EQUITY", analytic: true, systemKey: "CAPITAL" },
  { code: "2.3.2", name: "Lucros ou prejuízos acumulados", nature: "EQUITY", analytic: true, systemKey: "RETAINED_EARNINGS" },
  { code: "2.3.3", name: "Saldos de implantação (contrapartida)", nature: "EQUITY", analytic: true, systemKey: "OPENING_BALANCES" },
  { code: "3", name: "Receitas", nature: "REVENUE", analytic: false },
  { code: "3.1.01", name: "Receita de prestação de serviços", nature: "REVENUE", analytic: true, systemKey: "REV_SERVICES" },
  { code: "3.1.02", name: "Receita de venda de mercadorias e produtos", nature: "REVENUE", analytic: true, systemKey: "REV_GOODS" },
  { code: "3.1.03", name: "Outras receitas operacionais", nature: "REVENUE", analytic: true, systemKey: "REV_OTHER" },
  { code: "3.2.01", name: "Receitas financeiras", nature: "REVENUE", analytic: true, systemKey: "FIN_INCOME" },
  { code: "4", name: "Custos e despesas", nature: "EXPENSE", analytic: false },
  { code: "4.1.01", name: "Custo das mercadorias vendidas", nature: "EXPENSE", analytic: true, systemKey: "COGS" },
  { code: "4.1.02", name: "Materiais aplicados nos serviços", nature: "EXPENSE", analytic: true, systemKey: "MATERIALS_COST" },
  { code: "4.1.03", name: "Perdas e ajustes de estoque", nature: "EXPENSE", analytic: true, systemKey: "INVENTORY_ADJ" },
  { code: "4.1.04", name: "Serviços de terceiros", nature: "EXPENSE", analytic: true, systemKey: "THIRD_PARTY" },
  { code: "4.2.01", name: "Despesas com pessoal", nature: "EXPENSE", analytic: true, systemKey: "PAYROLL_EXPENSE" },
  { code: "4.2.02", name: "Despesas gerais e administrativas", nature: "EXPENSE", analytic: true, systemKey: "EXPENSES" },
  { code: "4.3.01", name: "Despesas financeiras e tarifas bancárias", nature: "EXPENSE", analytic: true, systemKey: "FIN_EXPENSE" },
  { code: "4.3.02", name: "Descontos concedidos", nature: "EXPENSE", analytic: true, systemKey: "DISCOUNTS_GRANTED" },
];

export const NATURE_LABEL: Record<Nature, string> = { ASSET: "Ativo", LIABILITY: "Passivo", EQUITY: "Patrimônio líquido", REVENUE: "Receita", EXPENSE: "Custo/despesa" };

/** Natureza devedora (ativo, custos/despesas) ou credora (passivo, PL, receitas). */
export const isDebitNature = (n: string) => n === "ASSET" || n === "EXPENSE";

export function parentCode(code: string) {
  const i = code.lastIndexOf(".");
  return i > 0 ? code.slice(0, i) : null;
}
