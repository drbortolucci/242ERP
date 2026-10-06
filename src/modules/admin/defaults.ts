/**
 * Configuração padrão criada para cada nova organização (editável no configurador).
 * Nada aqui representa regra fiscal: retenções e códigos fiscais são cadastrados pelo responsável fiscal.
 */
import { ROLE_TEMPLATES } from "@/lib/permissions";

export const DEFAULT_ACCOUNTS: { code: string; name: string; type: "REVENUE" | "DEDUCTION" | "DIRECT_COST" | "OPERATING_EXPENSE" | "FINANCIAL" | "OTHER"; systemKey?: string; parent?: string }[] = [
  { code: "1", name: "Receita bruta de serviços", type: "REVENUE" },
  { code: "1.01", name: "Receita de projetos", type: "REVENUE", systemKey: "REVENUE_PROJECTS", parent: "1" },
  { code: "1.02", name: "Receita recorrente AMS", type: "REVENUE", systemKey: "REVENUE_AMS", parent: "1" },
  { code: "1.03", name: "Receita de alocação", type: "REVENUE", systemKey: "REVENUE_ALLOCATION", parent: "1" },
  { code: "1.04", name: "Reembolso de despesas cobradas", type: "REVENUE", systemKey: "REVENUE_REIMBURSEMENT", parent: "1" },
  { code: "2", name: "Deduções da receita", type: "DEDUCTION" },
  { code: "2.01", name: "Tributos sobre receita (gerencial)", type: "DEDUCTION", systemKey: "DEDUCTION_TAXES", parent: "2" },
  { code: "3", name: "Custos diretos", type: "DIRECT_COST" },
  { code: "3.01", name: "Custo de profissionais internos alocados", type: "DIRECT_COST", systemKey: "LABOR_COST", parent: "3" },
  { code: "3.02", name: "Custo de terceiros e subcontratados", type: "DIRECT_COST", systemKey: "THIRD_PARTY_COST", parent: "3" },
  { code: "3.03", name: "Despesas diretas de projetos", type: "DIRECT_COST", systemKey: "DIRECT_EXPENSES", parent: "3" },
  { code: "3.04", name: "Licenças e outros custos atribuíveis", type: "DIRECT_COST", systemKey: "LICENSE_COST", parent: "3" },
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

export const DEFAULT_LOSS_REASONS = ["Preço", "Prazo", "Escopo não atendido", "Concorrente", "Projeto cancelado pelo cliente", "Sem orçamento"];

export const DEFAULT_PROJECT_TYPES = [
  { name: "Implementação ERP", templateKey: "ERP_IMPLEMENTATION" },
  { name: "Diagnóstico", templateKey: "DIAGNOSTIC" },
  { name: "Rollout", templateKey: "ROLLOUT" },
  { name: "Integração", templateKey: "INTEGRATION" },
  { name: "Treinamento", templateKey: "TRAINING" },
  { name: "Advisory", templateKey: "ADVISORY" },
  { name: "Alocação", templateKey: "ALLOCATION" },
  { name: "AMS / Sustentação", templateKey: "AMS" },
];

export const DEFAULT_TEAM_ROLES = ["Gerente de projeto", "Arquiteto de soluções", "Consultor funcional", "Consultor técnico", "Desenvolvedor", "Analista de suporte", "Instrutor"];
export const DEFAULT_SENIORITY = ["Júnior", "Pleno", "Sênior", "Especialista"];
export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: "Transporte", reimbursableDefault: true, billableDefault: true },
  { name: "Hospedagem", reimbursableDefault: true, billableDefault: true },
  { name: "Alimentação", reimbursableDefault: true, billableDefault: false },
  { name: "Quilometragem", reimbursableDefault: true, billableDefault: true },
  { name: "Software e ferramentas", reimbursableDefault: false, billableDefault: false },
];
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
  name: "SLA padrão AMS",
  pauseStatuses: ["WAITING_CUSTOMER", "WAITING_THIRD_PARTY"],
  targets: [
    { priority: "P1", responseMinutes: 30, resolutionMinutes: 240 },
    { priority: "P2", responseMinutes: 60, resolutionMinutes: 480 },
    { priority: "P3", responseMinutes: 240, resolutionMinutes: 1440 },
    { priority: "P4", responseMinutes: 480, resolutionMinutes: 2880 },
  ],
};

export const DEFAULT_SERVICES = [
  { code: "IMPL", name: "Implementação de sistemas", category: "IMPLEMENTATION", defaultModel: "FIXED_PRICE", account: "REVENUE_PROJECTS" },
  { code: "CONS", name: "Consultoria", category: "CONSULTING", defaultModel: "TIME_MATERIAL", account: "REVENUE_PROJECTS" },
  { code: "ALOC", name: "Alocação de profissionais", category: "ALLOCATION", defaultModel: "MONTHLY_ALLOCATION", account: "REVENUE_ALLOCATION" },
  { code: "AMS", name: "Sustentação AMS", category: "AMS", defaultModel: "AMS_RECURRING", account: "REVENUE_AMS" },
  { code: "ADV", name: "Advisory", category: "ADVISORY", defaultModel: "ADVISORY", account: "REVENUE_PROJECTS" },
  { code: "TRN", name: "Treinamento", category: "TRAINING", defaultModel: "TRAINING", account: "REVENUE_PROJECTS" },
];

export { ROLE_TEMPLATES };

/** Modelos de WBS por tipo de projeto (fases → entregáveis). */
export const PROJECT_TEMPLATES: Record<string, { phase: string; items: { name: string; kind: "DELIVERABLE" | "TASK" | "MILESTONE"; share: number; acceptance?: boolean }[] }[]> = {
  ERP_IMPLEMENTATION: [
    { phase: "Preparação", items: [{ name: "Kick-off", kind: "MILESTONE", share: 2 }, { name: "Plano do projeto", kind: "DELIVERABLE", share: 3, acceptance: true }] },
    { phase: "Desenho da solução", items: [{ name: "Workshops de processos", kind: "TASK", share: 10 }, { name: "Documento de desenho (BBP)", kind: "DELIVERABLE", share: 10, acceptance: true }] },
    { phase: "Realização", items: [{ name: "Configuração", kind: "TASK", share: 25 }, { name: "Desenvolvimentos e integrações", kind: "TASK", share: 20 }, { name: "Testes integrados", kind: "DELIVERABLE", share: 10, acceptance: true }] },
    { phase: "Preparação final", items: [{ name: "Treinamento de usuários", kind: "TASK", share: 8 }, { name: "Migração de dados", kind: "TASK", share: 7 }] },
    { phase: "Go-live e suporte", items: [{ name: "Go-live", kind: "MILESTONE", share: 1, acceptance: true }, { name: "Suporte pós go-live", kind: "TASK", share: 4 }] },
  ],
  DIAGNOSTIC: [
    { phase: "Levantamento", items: [{ name: "Entrevistas", kind: "TASK", share: 40 }, { name: "Mapeamento AS-IS", kind: "DELIVERABLE", share: 25, acceptance: true }] },
    { phase: "Recomendações", items: [{ name: "Relatório de diagnóstico", kind: "DELIVERABLE", share: 30, acceptance: true }, { name: "Apresentação executiva", kind: "MILESTONE", share: 5 }] },
  ],
  ROLLOUT: [
    { phase: "Análise de localização", items: [{ name: "Gap analysis local", kind: "DELIVERABLE", share: 20, acceptance: true }] },
    { phase: "Adaptação", items: [{ name: "Configuração local", kind: "TASK", share: 40 }, { name: "Testes", kind: "TASK", share: 20 }] },
    { phase: "Go-live", items: [{ name: "Cutover", kind: "MILESTONE", share: 10, acceptance: true }, { name: "Hypercare", kind: "TASK", share: 10 }] },
  ],
  INTEGRATION: [
    { phase: "Especificação", items: [{ name: "Especificação de interfaces", kind: "DELIVERABLE", share: 20, acceptance: true }] },
    { phase: "Construção", items: [{ name: "Desenvolvimento", kind: "TASK", share: 50 }, { name: "Testes de integração", kind: "DELIVERABLE", share: 20, acceptance: true }] },
    { phase: "Implantação", items: [{ name: "Produção", kind: "MILESTONE", share: 10 }] },
  ],
  TRAINING: [
    { phase: "Preparação", items: [{ name: "Material didático", kind: "DELIVERABLE", share: 40, acceptance: true }] },
    { phase: "Execução", items: [{ name: "Turmas", kind: "TASK", share: 50 }, { name: "Avaliação de reação", kind: "DELIVERABLE", share: 10 }] },
  ],
  ADVISORY: [{ phase: "Aconselhamento", items: [{ name: "Sessões de advisory", kind: "TASK", share: 80 }, { name: "Relatório executivo", kind: "DELIVERABLE", share: 20, acceptance: true }] }],
  ALLOCATION: [{ phase: "Alocação", items: [{ name: "Atividades alocadas", kind: "TASK", share: 100 }] }],
  AMS: [{ phase: "Sustentação", items: [{ name: "Atendimento de chamados", kind: "TASK", share: 90 }, { name: "Relatório mensal de SLA", kind: "DELIVERABLE", share: 10 }] }],
};
