/**
 * Configuração padrão criada para cada nova organização (editável no configurador).
 * Nada aqui representa regra fiscal: retenções e códigos fiscais são cadastrados pelo responsável fiscal.
 */
import { ROLE_TEMPLATES } from "@/lib/permissions";
import { DEFAULT_SECTOR, SECTOR_PROFILES } from "@/domain/sectors";
import { WBS_TEMPLATES, type WbsTemplate } from "@/domain/wbs-templates";

export const DEFAULT_ACCOUNTS: { code: string; name: string; type: "REVENUE" | "DEDUCTION" | "DIRECT_COST" | "OPERATING_EXPENSE" | "FINANCIAL" | "OTHER"; systemKey?: string; parent?: string }[] = [
  { code: "1", name: "Receita bruta de serviços", type: "REVENUE" },
  { code: "1.01", name: "Receita de projetos e serviços", type: "REVENUE", systemKey: "REVENUE_PROJECTS", parent: "1" },
  { code: "1.02", name: "Receita de contratos recorrentes (AMS, manutenção, fee)", type: "REVENUE", systemKey: "REVENUE_AMS", parent: "1" },
  { code: "1.03", name: "Receita de alocação de equipe", type: "REVENUE", systemKey: "REVENUE_ALLOCATION", parent: "1" },
  { code: "1.04", name: "Reembolso de despesas cobradas", type: "REVENUE", systemKey: "REVENUE_REIMBURSEMENT", parent: "1" },
  { code: "1.05", name: "Receita de venda de mercadorias e produtos", type: "REVENUE", systemKey: "REVENUE_GOODS", parent: "1" },
  { code: "2", name: "Deduções da receita", type: "DEDUCTION" },
  { code: "2.01", name: "Tributos sobre receita (gerencial)", type: "DEDUCTION", systemKey: "DEDUCTION_TAXES", parent: "2" },
  { code: "3", name: "Custos diretos", type: "DIRECT_COST" },
  { code: "3.01", name: "Custo de profissionais internos alocados", type: "DIRECT_COST", systemKey: "LABOR_COST", parent: "3" },
  { code: "3.02", name: "Custo de terceiros e subcontratados", type: "DIRECT_COST", systemKey: "THIRD_PARTY_COST", parent: "3" },
  { code: "3.03", name: "Despesas diretas de projetos e serviços", type: "DIRECT_COST", systemKey: "DIRECT_EXPENSES", parent: "3" },
  { code: "3.04", name: "Materiais, licenças e outros custos atribuíveis", type: "DIRECT_COST", systemKey: "LICENSE_COST", parent: "3" },
  { code: "3.05", name: "Custo das mercadorias e produtos vendidos", type: "DIRECT_COST", systemKey: "COGS", parent: "3" },
  { code: "3.06", name: "Perdas e ajustes de estoque", type: "DIRECT_COST", systemKey: "INVENTORY_ADJUSTMENTS", parent: "3" },
  { code: "4", name: "Despesas operacionais", type: "OPERATING_EXPENSE" },
  { code: "4.01", name: "Pessoal (folha)", type: "OPERATING_EXPENSE", systemKey: "PAYROLL", parent: "4" },
  // Conta redutora: absorção do custo de pessoal apropriado aos projetos (evita duplicidade com a folha)
  { code: "4.02", name: "(-) Pessoal absorvido por projetos", type: "OPERATING_EXPENSE", systemKey: "LABOR_ABSORPTION", parent: "4" },
  { code: "4.03", name: "Despesas administrativas", type: "OPERATING_EXPENSE", systemKey: "ADMIN_EXPENSES", parent: "4" },
  { code: "4.04", name: "Despesas comerciais", type: "OPERATING_EXPENSE", systemKey: "SALES_EXPENSES", parent: "4" },
  { code: "4.05", name: "Rateio de despesas indiretas recebido", type: "OPERATING_EXPENSE", systemKey: "ALLOCATED_OVERHEAD", parent: "4" },
  { code: "4.06", name: "Comissões comerciais", type: "OPERATING_EXPENSE", systemKey: "COMMISSIONS", parent: "4" },
  { code: "5", name: "Resultado financeiro", type: "FINANCIAL" },
  { code: "5.01", name: "Juros e multas recebidos", type: "FINANCIAL", systemKey: "FIN_INCOME", parent: "5" },
  { code: "5.02", name: "Descontos concedidos e tarifas", type: "FINANCIAL", systemKey: "FIN_EXPENSE", parent: "5" },
];

export const DEFAULT_PIPELINE = [
  { name: "Prospecção", probability: 10, kind: "OPEN" },
  { name: "Qualificação", probability: 25, kind: "OPEN" },
  { name: "Proposta", probability: 50, kind: "OPEN" },
  { name: "Negociação", probability: 75, kind: "OPEN" },
  { name: "Ganha", probability: 100, kind: "WON" },
  { name: "Perdida", probability: 0, kind: "LOST" },
];

export const DEFAULT_LOSS_REASONS = ["Preço", "Prazo", "Escopo não atendido", "Concorrente", "Demanda cancelada pelo cliente", "Sem orçamento"];

/** Valores do setor padrão (consultoria e TI). Novas organizações recebem os itens do setor escolhido (src/domain/sectors.ts). */
const DEFAULT_PROFILE = SECTOR_PROFILES[DEFAULT_SECTOR];
export const DEFAULT_PROJECT_TYPES = DEFAULT_PROFILE.projectTypes;
export const DEFAULT_TEAM_ROLES = DEFAULT_PROFILE.teamRoles;
export const DEFAULT_SENIORITY = ["Júnior", "Pleno", "Sênior", "Especialista"];
export const DEFAULT_EXPENSE_CATEGORIES = DEFAULT_PROFILE.expenseCategories;
export const DEFAULT_PAYMENT_TERMS = [
  { name: "À vista", installments: [{ days: 0, percent: "100" }] },
  { name: "30 dias", installments: [{ days: 30, percent: "100" }] },
  { name: "30/60", installments: [{ days: 30, percent: "50" }, { days: 60, percent: "50" }] },
  { name: "15 dias", installments: [{ days: 15, percent: "100" }] },
];
export const DEFAULT_PAYMENT_METHODS = ["Boleto", "PIX", "Transferência", "Cartão corporativo"];

export const DEFAULT_APPROVAL_RULES = [
  { docType: "PROPOSAL", name: "Desconto acima de 10%", maxDiscountPct: "10", requiredPermission: "proposal.approve" },
  { docType: "PROPOSAL", name: "Margem abaixo de 25%", minMarginPct: "25", requiredPermission: "proposal.approve" },
  { docType: "PROPOSAL", name: "Valor acima de R$ 500 mil", minAmount: "500000", requiredPermission: "proposal.approve_high" },
  { docType: "PURCHASE_ORDER", name: "Toda compra", minAmount: "0", requiredPermission: "purchase.approve" },
  { docType: "EXPENSE", name: "Toda despesa", minAmount: "0", requiredPermission: "expense.approve" },
  { docType: "PAYABLE", name: "Toda conta a pagar", minAmount: "0", requiredPermission: "payable.approve" },
  { docType: "MEASUREMENT", name: "Toda medição", minAmount: "0", requiredPermission: "billing.approve" },
];

export const DEFAULT_SLA = {
  name: "Nível de serviço padrão",
  pauseStatuses: ["WAITING_CUSTOMER", "WAITING_THIRD_PARTY"],
  targets: [
    { priority: "P1", responseMinutes: 30, resolutionMinutes: 240 },
    { priority: "P2", responseMinutes: 60, resolutionMinutes: 480 },
    { priority: "P3", responseMinutes: 240, resolutionMinutes: 1440 },
    { priority: "P4", responseMinutes: 480, resolutionMinutes: 2880 },
  ],
};

export const DEFAULT_SERVICES = DEFAULT_PROFILE.services;

export { ROLE_TEMPLATES };

/** Modelos de WBS por chave (compatibilidade): ver a biblioteca em src/domain/wbs-templates.ts. */
export const PROJECT_TEMPLATES: Record<string, WbsTemplate> = Object.fromEntries(Object.entries(WBS_TEMPLATES).map(([k, v]) => [k, v.phases]));
