/**
 * Perfis de setor de atividade (empresas de serviços). O perfil define apenas pontos de partida editáveis:
 * tipos de projeto e modelos de WBS, papéis de equipe, catálogo de serviços, categorias de despesa, competências
 * e a terminologia exibida. Regras de negócio, cálculos e controles são os mesmos para todos os setores.
 * Nada aqui é regra fiscal ou tributária.
 */
import { WBS_TEMPLATES } from "./wbs-templates";

export const TERM_KEYS = {
  project: { label: "Projeto (singular)", default: "Projeto" },
  projects: { label: "Projetos (plural)", default: "Projetos" },
  professional: { label: "Profissional (singular)", default: "Profissional" },
  professionals: { label: "Profissionais (plural)", default: "Profissionais" },
  ticket: { label: "Chamado (singular)", default: "Chamado" },
  tickets: { label: "Chamados (plural)", default: "Chamados" },
  supportArea: { label: "Área de atendimento recorrente (menu)", default: "Atendimento" },
  balances: { label: "Saldos de contratos recorrentes", default: "Saldos e franquias" },
  systemField: { label: "Campo \"sistema\" do chamado", default: "Sistema" },
  moduleField: { label: "Campo \"módulo\" do chamado", default: "Módulo" },
} as const;
export type TermKey = keyof typeof TERM_KEYS;
export type Terms = Record<TermKey, string>;
export const DEFAULT_TERMS = Object.fromEntries(Object.entries(TERM_KEYS).map(([k, v]) => [k, v.default])) as Terms;

/** Categorias de serviço (metadado de catálogo; não altera cálculos). */
export const SERVICE_CATEGORIES = [
  { value: "IMPLEMENTATION", label: "Implementação" }, { value: "CONSULTING", label: "Consultoria" }, { value: "ALLOCATION", label: "Alocação de equipe" },
  { value: "AMS", label: "Sustentação / AMS" }, { value: "ADVISORY", label: "Advisory / assessoria" }, { value: "TRAINING", label: "Treinamento / educação" },
  { value: "PROJECT", label: "Projeto / escopo fechado" }, { value: "RECURRING", label: "Serviço recorrente" }, { value: "MAINTENANCE", label: "Manutenção / serviço em campo" },
  { value: "CREATIVE", label: "Criação / produção" }, { value: "DEVELOPMENT", label: "Desenvolvimento" }, { value: "TECHNICAL", label: "Serviço técnico / laudo" },
  { value: "OTHER", label: "Outro" },
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number]["value"];

/** Conta gerencial de receita (chave do plano de contas padrão). */
type RevenueKey = "REVENUE_PROJECTS" | "REVENUE_AMS" | "REVENUE_ALLOCATION";
export type CommercialModel = "FIXED_PRICE" | "TIME_MATERIAL" | "MONTHLY_ALLOCATION" | "HOUR_PACKAGE" | "AMS_RECURRING" | "ADVISORY" | "TRAINING" | "HYBRID";

export interface SectorProfile {
  key: string;
  name: string;
  description: string;
  terms: Partial<Terms>;
  projectTypes: { name: string; templateKey: keyof typeof WBS_TEMPLATES }[];
  teamRoles: string[];
  services: { code: string; name: string; category: ServiceCategory; defaultModel: CommercialModel; account: RevenueKey }[];
  expenseCategories: { name: string; reimbursableDefault: boolean; billableDefault: boolean }[];
  skills: string[];
}

const BASE_EXPENSES = [
  { name: "Transporte", reimbursableDefault: true, billableDefault: true },
  { name: "Hospedagem", reimbursableDefault: true, billableDefault: true },
  { name: "Alimentação", reimbursableDefault: true, billableDefault: false },
  { name: "Quilometragem", reimbursableDefault: true, billableDefault: true },
  { name: "Software e ferramentas", reimbursableDefault: false, billableDefault: false },
];

export const SECTOR_PROFILES: Record<string, SectorProfile> = {
  CONSULTING_IT: {
    key: "CONSULTING_IT", name: "Consultoria e serviços de TI (ERP, sistemas)",
    description: "Implementação de sistemas, integrações, alocação de consultores, sustentação (AMS) e advisory. Especialidade da plataforma.",
    terms: { professional: "Consultor", professionals: "Consultores", supportArea: "AMS", systemField: "Sistema", moduleField: "Módulo" },
    projectTypes: [
      { name: "Implementação ERP", templateKey: "ERP_IMPLEMENTATION" }, { name: "Diagnóstico", templateKey: "DIAGNOSTIC" }, { name: "Rollout", templateKey: "ROLLOUT" },
      { name: "Integração", templateKey: "INTEGRATION" }, { name: "Treinamento", templateKey: "TRAINING" }, { name: "Advisory", templateKey: "ADVISORY" },
      { name: "Alocação", templateKey: "ALLOCATION" }, { name: "AMS / Sustentação", templateKey: "AMS" },
    ],
    teamRoles: ["Gerente de projeto", "Arquiteto de soluções", "Consultor funcional", "Consultor técnico", "Desenvolvedor", "Analista de suporte", "Instrutor"],
    services: [
      { code: "IMPL", name: "Implementação de sistemas", category: "IMPLEMENTATION", defaultModel: "FIXED_PRICE", account: "REVENUE_PROJECTS" },
      { code: "CONS", name: "Consultoria", category: "CONSULTING", defaultModel: "TIME_MATERIAL", account: "REVENUE_PROJECTS" },
      { code: "ALOC", name: "Alocação de profissionais", category: "ALLOCATION", defaultModel: "MONTHLY_ALLOCATION", account: "REVENUE_ALLOCATION" },
      { code: "AMS", name: "Sustentação AMS", category: "AMS", defaultModel: "AMS_RECURRING", account: "REVENUE_AMS" },
      { code: "ADV", name: "Advisory", category: "ADVISORY", defaultModel: "ADVISORY", account: "REVENUE_PROJECTS" },
      { code: "TRN", name: "Treinamento", category: "TRAINING", defaultModel: "TRAINING", account: "REVENUE_PROJECTS" },
    ],
    expenseCategories: BASE_EXPENSES,
    skills: ["Mapeamento de processos", "Gestão de mudanças", "Banco de dados", "Testes de software"],
  },
  MANAGEMENT_CONSULTING: {
    key: "MANAGEMENT_CONSULTING", name: "Consultoria empresarial e de gestão",
    description: "Estratégia, processos, finanças, pessoas, mentoria e assessoria recorrente.",
    terms: { professional: "Consultor", professionals: "Consultores", ticket: "Solicitação", tickets: "Solicitações", supportArea: "Assessoria recorrente", balances: "Saldos de horas", systemField: "Área", moduleField: "Processo" },
    projectTypes: [
      { name: "Diagnóstico", templateKey: "DIAGNOSTIC" }, { name: "Planejamento estratégico", templateKey: "STRATEGY" }, { name: "Projeto de melhoria", templateKey: "GENERIC_PROJECT" },
      { name: "Treinamento", templateKey: "TRAINING" }, { name: "Mentoria / advisory", templateKey: "ADVISORY" }, { name: "Assessoria recorrente", templateKey: "RETAINER" },
    ],
    teamRoles: ["Sócio responsável", "Gerente de projeto", "Consultor sênior", "Consultor", "Analista", "Instrutor"],
    services: [
      { code: "DIAG", name: "Diagnóstico empresarial", category: "CONSULTING", defaultModel: "FIXED_PRICE", account: "REVENUE_PROJECTS" },
      { code: "CONS", name: "Consultoria por hora", category: "CONSULTING", defaultModel: "TIME_MATERIAL", account: "REVENUE_PROJECTS" },
      { code: "PLAN", name: "Planejamento estratégico", category: "PROJECT", defaultModel: "FIXED_PRICE", account: "REVENUE_PROJECTS" },
      { code: "ASSR", name: "Assessoria mensal", category: "RECURRING", defaultModel: "AMS_RECURRING", account: "REVENUE_AMS" },
      { code: "MENT", name: "Mentoria executiva", category: "ADVISORY", defaultModel: "HOUR_PACKAGE", account: "REVENUE_PROJECTS" },
      { code: "TRN", name: "Treinamento in company", category: "TRAINING", defaultModel: "TRAINING", account: "REVENUE_PROJECTS" },
    ],
    expenseCategories: BASE_EXPENSES,
    skills: ["Estratégia", "Processos", "Finanças corporativas", "Gestão de pessoas", "Indicadores de desempenho"],
  },
  ENGINEERING: {
    key: "ENGINEERING", name: "Engenharia, arquitetura e serviços técnicos",
    description: "Projetos técnicos, estudos de viabilidade, gerenciamento e fiscalização de obras, laudos e manutenção.",
    terms: { ticket: "Ordem de serviço", tickets: "Ordens de serviço", supportArea: "Manutenção", balances: "Saldos de contratos", systemField: "Ativo / edificação", moduleField: "Local" },
    projectTypes: [
      { name: "Projeto de engenharia / arquitetura", templateKey: "ENGINEERING_DESIGN" }, { name: "Estudo de viabilidade", templateKey: "FEASIBILITY" },
      { name: "Gerenciamento de obra", templateKey: "WORKS_MANAGEMENT" }, { name: "Laudo / parecer técnico", templateKey: "TECHNICAL_REPORT" },
      { name: "Contrato de manutenção", templateKey: "MAINTENANCE" }, { name: "Projeto genérico", templateKey: "GENERIC_PROJECT" },
    ],
    teamRoles: ["Engenheiro responsável", "Arquiteto", "Engenheiro projetista", "Projetista", "Técnico de campo", "Fiscal de obra"],
    services: [
      { code: "PROJ", name: "Projeto técnico", category: "PROJECT", defaultModel: "FIXED_PRICE", account: "REVENUE_PROJECTS" },
      { code: "CTEC", name: "Consultoria técnica (hora)", category: "CONSULTING", defaultModel: "TIME_MATERIAL", account: "REVENUE_PROJECTS" },
      { code: "GOBR", name: "Gerenciamento de obra", category: "ALLOCATION", defaultModel: "MONTHLY_ALLOCATION", account: "REVENUE_ALLOCATION" },
      { code: "LAUD", name: "Laudo técnico", category: "TECHNICAL", defaultModel: "FIXED_PRICE", account: "REVENUE_PROJECTS" },
      { code: "MANT", name: "Contrato de manutenção", category: "MAINTENANCE", defaultModel: "AMS_RECURRING", account: "REVENUE_AMS" },
    ],
    expenseCategories: [...BASE_EXPENSES, { name: "Combustível", reimbursableDefault: true, billableDefault: true }, { name: "Materiais e EPIs de campo", reimbursableDefault: true, billableDefault: false }],
    skills: ["Estruturas", "Instalações elétricas", "Instalações hidráulicas", "Modelagem BIM", "Orçamentação"],
  },
  AGENCY: {
    key: "AGENCY", name: "Agências de marketing, comunicação e design",
    description: "Campanhas, branding, produção digital, conteúdo e contratos de fee mensal com banco de horas.",
    terms: { project: "Job", projects: "Jobs", ticket: "Solicitação", tickets: "Solicitações", supportArea: "Fee mensal", balances: "Saldos de fee", systemField: "Marca / canal", moduleField: "Peça" },
    projectTypes: [
      { name: "Campanha", templateKey: "CAMPAIGN" }, { name: "Branding", templateKey: "BRANDING" }, { name: "Site / digital", templateKey: "WEBSITE" },
      { name: "Fee mensal", templateKey: "RETAINER" }, { name: "Job avulso", templateKey: "GENERIC_PROJECT" },
    ],
    teamRoles: ["Atendimento", "Diretor de criação", "Redator", "Designer", "Mídia", "Social media", "Desenvolvedor web"],
    services: [
      { code: "FEE", name: "Fee mensal", category: "RECURRING", defaultModel: "AMS_RECURRING", account: "REVENUE_AMS" },
      { code: "CAMP", name: "Campanha", category: "CREATIVE", defaultModel: "FIXED_PRICE", account: "REVENUE_PROJECTS" },
      { code: "JOB", name: "Job avulso", category: "CREATIVE", defaultModel: "FIXED_PRICE", account: "REVENUE_PROJECTS" },
      { code: "HORA", name: "Hora técnica", category: "CREATIVE", defaultModel: "TIME_MATERIAL", account: "REVENUE_PROJECTS" },
      { code: "WEB", name: "Site e produção digital", category: "DEVELOPMENT", defaultModel: "FIXED_PRICE", account: "REVENUE_PROJECTS" },
    ],
    expenseCategories: [...BASE_EXPENSES, { name: "Produção gráfica e audiovisual", reimbursableDefault: false, billableDefault: true }, { name: "Banco de imagens e licenças", reimbursableDefault: false, billableDefault: true }],
    skills: ["Direção de arte", "Redação", "Mídia paga", "Redes sociais", "Design de interfaces"],
  },
  PROFESSIONAL_OFFICE: {
    key: "PROFESSIONAL_OFFICE", name: "Escritórios contábeis, jurídicos e de auditoria",
    description: "Rotinas mensais, casos e processos, auditorias, pareceres e honorários recorrentes.",
    terms: { project: "Trabalho", projects: "Trabalhos", ticket: "Solicitação", tickets: "Solicitações", supportArea: "Atendimento recorrente", balances: "Saldos de honorários", systemField: "Área", moduleField: "Assunto" },
    projectTypes: [
      { name: "Rotina mensal", templateKey: "MONTHLY_ROUTINE" }, { name: "Caso / processo", templateKey: "CASE" }, { name: "Auditoria", templateKey: "AUDIT" },
      { name: "Parecer / consulta", templateKey: "TECHNICAL_REPORT" }, { name: "Projeto avulso", templateKey: "GENERIC_PROJECT" },
    ],
    teamRoles: ["Sócio", "Gerente", "Profissional sênior", "Profissional", "Assistente", "Estagiário"],
    services: [
      { code: "HONM", name: "Honorários mensais", category: "RECURRING", defaultModel: "AMS_RECURRING", account: "REVENUE_AMS" },
      { code: "HORA", name: "Hora técnica", category: "CONSULTING", defaultModel: "TIME_MATERIAL", account: "REVENUE_PROJECTS" },
      { code: "CASO", name: "Honorários por trabalho", category: "PROJECT", defaultModel: "FIXED_PRICE", account: "REVENUE_PROJECTS" },
      { code: "AUD", name: "Auditoria", category: "PROJECT", defaultModel: "FIXED_PRICE", account: "REVENUE_PROJECTS" },
    ],
    expenseCategories: [...BASE_EXPENSES, { name: "Custas, taxas e certidões", reimbursableDefault: true, billableDefault: true }, { name: "Correios e cartório", reimbursableDefault: true, billableDefault: true }],
    skills: ["Contabilidade", "Tributário", "Trabalhista", "Societário", "Contencioso"],
  },
  FIELD_SERVICES: {
    key: "FIELD_SERVICES", name: "Manutenção, facilities e serviços em campo",
    description: "Instalações, manutenção preventiva e corretiva, vistorias, equipes residentes e contratos de manutenção.",
    terms: { professional: "Técnico", professionals: "Técnicos", ticket: "Ordem de serviço", tickets: "Ordens de serviço", supportArea: "Manutenção", balances: "Saldos de contratos", systemField: "Equipamento", moduleField: "Local" },
    projectTypes: [
      { name: "Instalação", templateKey: "INSTALLATION" }, { name: "Contrato de manutenção", templateKey: "MAINTENANCE" }, { name: "Vistoria / inspeção", templateKey: "TECHNICAL_REPORT" },
      { name: "Equipe residente", templateKey: "ALLOCATION" }, { name: "Projeto genérico", templateKey: "GENERIC_PROJECT" },
    ],
    teamRoles: ["Coordenador de operações", "Supervisor", "Planejador de manutenção", "Técnico", "Auxiliar técnico"],
    services: [
      { code: "MANT", name: "Contrato de manutenção", category: "MAINTENANCE", defaultModel: "AMS_RECURRING", account: "REVENUE_AMS" },
      { code: "AVUL", name: "Atendimento avulso", category: "MAINTENANCE", defaultModel: "TIME_MATERIAL", account: "REVENUE_PROJECTS" },
      { code: "INST", name: "Instalação", category: "PROJECT", defaultModel: "FIXED_PRICE", account: "REVENUE_PROJECTS" },
      { code: "RESI", name: "Equipe residente", category: "ALLOCATION", defaultModel: "MONTHLY_ALLOCATION", account: "REVENUE_ALLOCATION" },
    ],
    expenseCategories: [...BASE_EXPENSES, { name: "Combustível", reimbursableDefault: true, billableDefault: true }, { name: "Peças e materiais", reimbursableDefault: false, billableDefault: true }, { name: "Pedágio e estacionamento", reimbursableDefault: true, billableDefault: true }],
    skills: ["Elétrica", "Refrigeração e climatização", "Hidráulica", "Automação", "Segurança do trabalho"],
  },
  SOFTWARE: {
    key: "SOFTWARE", name: "Desenvolvimento de software e produtos digitais",
    description: "Desenvolvimento por escopo, squads dedicados, discovery/UX, banco de horas e sustentação.",
    terms: { supportArea: "Sustentação", systemField: "Produto", moduleField: "Funcionalidade" },
    projectTypes: [
      { name: "Desenvolvimento", templateKey: "SOFTWARE_DEVELOPMENT" }, { name: "Discovery / UX", templateKey: "DISCOVERY" }, { name: "Squad dedicado", templateKey: "ALLOCATION" },
      { name: "Integração", templateKey: "INTEGRATION" }, { name: "Sustentação", templateKey: "AMS" },
    ],
    teamRoles: ["Gerente de produto", "Tech lead", "Desenvolvedor", "Designer UX/UI", "Analista de qualidade", "DevOps"],
    services: [
      { code: "DEV", name: "Desenvolvimento por escopo", category: "DEVELOPMENT", defaultModel: "FIXED_PRICE", account: "REVENUE_PROJECTS" },
      { code: "SQD", name: "Squad dedicado", category: "ALLOCATION", defaultModel: "MONTHLY_ALLOCATION", account: "REVENUE_ALLOCATION" },
      { code: "BH", name: "Banco de horas", category: "DEVELOPMENT", defaultModel: "HOUR_PACKAGE", account: "REVENUE_PROJECTS" },
      { code: "SUST", name: "Sustentação", category: "AMS", defaultModel: "AMS_RECURRING", account: "REVENUE_AMS" },
      { code: "UX", name: "Discovery / UX", category: "CONSULTING", defaultModel: "FIXED_PRICE", account: "REVENUE_PROJECTS" },
    ],
    expenseCategories: BASE_EXPENSES,
    skills: ["Front-end", "Back-end", "Mobile", "Cloud", "Testes automatizados"],
  },
  EDUCATION: {
    key: "EDUCATION", name: "Educação corporativa, treinamentos e eventos",
    description: "Cursos, turmas in company, programas de desenvolvimento, conteúdo e eventos.",
    terms: { project: "Programa", projects: "Programas", professional: "Instrutor", professionals: "Instrutores", ticket: "Solicitação", tickets: "Solicitações", supportArea: "Tutoria e suporte", systemField: "Curso", moduleField: "Turma" },
    projectTypes: [
      { name: "Curso / turma", templateKey: "COURSE" }, { name: "Programa de desenvolvimento", templateKey: "GENERIC_PROJECT" }, { name: "Evento", templateKey: "EVENT" },
      { name: "Treinamento", templateKey: "TRAINING" }, { name: "Tutoria recorrente", templateKey: "RETAINER" },
    ],
    teamRoles: ["Coordenador pedagógico", "Instrutor", "Conteudista", "Produtor", "Tutor"],
    services: [
      { code: "CUR", name: "Curso in company", category: "TRAINING", defaultModel: "TRAINING", account: "REVENUE_PROJECTS" },
      { code: "PRG", name: "Programa de desenvolvimento", category: "PROJECT", defaultModel: "FIXED_PRICE", account: "REVENUE_PROJECTS" },
      { code: "CONT", name: "Produção de conteúdo", category: "CREATIVE", defaultModel: "FIXED_PRICE", account: "REVENUE_PROJECTS" },
      { code: "TUT", name: "Tutoria", category: "RECURRING", defaultModel: "HOUR_PACKAGE", account: "REVENUE_PROJECTS" },
      { code: "EVT", name: "Evento", category: "PROJECT", defaultModel: "FIXED_PRICE", account: "REVENUE_PROJECTS" },
    ],
    expenseCategories: [...BASE_EXPENSES, { name: "Material didático e impressos", reimbursableDefault: false, billableDefault: true }, { name: "Locação de espaço e equipamentos", reimbursableDefault: false, billableDefault: true }],
    skills: ["Liderança", "Comunicação", "Didática", "Educação a distância"],
  },
  GENERAL_SERVICES: {
    key: "GENERAL_SERVICES", name: "Outros serviços (genérico)",
    description: "Ponto de partida neutro para qualquer empresa de serviços: projetos, serviços recorrentes, alocação e atendimentos avulsos.",
    terms: { ticket: "Atendimento", tickets: "Atendimentos", supportArea: "Serviços recorrentes", balances: "Saldos de contratos", systemField: "Item", moduleField: "Detalhe" },
    projectTypes: [
      { name: "Projeto", templateKey: "GENERIC_PROJECT" }, { name: "Serviço recorrente", templateKey: "RETAINER" }, { name: "Alocação de equipe", templateKey: "ALLOCATION" },
      { name: "Treinamento", templateKey: "TRAINING" },
    ],
    teamRoles: ["Gestor", "Coordenador", "Especialista", "Analista", "Técnico", "Assistente"],
    services: [
      { code: "PROJ", name: "Serviço por projeto", category: "PROJECT", defaultModel: "FIXED_PRICE", account: "REVENUE_PROJECTS" },
      { code: "HORA", name: "Hora técnica", category: "CONSULTING", defaultModel: "TIME_MATERIAL", account: "REVENUE_PROJECTS" },
      { code: "REC", name: "Serviço recorrente", category: "RECURRING", defaultModel: "AMS_RECURRING", account: "REVENUE_AMS" },
      { code: "ALOC", name: "Alocação de equipe", category: "ALLOCATION", defaultModel: "MONTHLY_ALLOCATION", account: "REVENUE_ALLOCATION" },
      { code: "PCT", name: "Pacote de horas", category: "OTHER", defaultModel: "HOUR_PACKAGE", account: "REVENUE_PROJECTS" },
    ],
    expenseCategories: BASE_EXPENSES,
    skills: [],
  },
};

export const DEFAULT_SECTOR = "CONSULTING_IT";
export const SECTOR_OPTIONS = Object.values(SECTOR_PROFILES).map((p) => ({ value: p.key, label: p.name }));

export function sectorProfile(key: string | null | undefined): SectorProfile {
  return SECTOR_PROFILES[key ?? ""] ?? SECTOR_PROFILES[DEFAULT_SECTOR];
}

/** Terminologia efetiva: padrão genérico ← perfil do setor ← personalizações da organização (vazias são ignoradas). */
export function resolveTerms(sector: string | null | undefined, overrides?: Partial<Record<string, string>> | null): Terms {
  const out = { ...DEFAULT_TERMS, ...sectorProfile(sector).terms };
  for (const k of Object.keys(TERM_KEYS) as TermKey[]) {
    const v = overrides?.[k]?.trim();
    if (v) out[k] = v.slice(0, 40);
  }
  return out;
}
