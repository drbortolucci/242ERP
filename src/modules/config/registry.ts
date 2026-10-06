/**
 * Registro das tabelas de configuração simples do configurador central.
 * Cada entrada descreve campos tipados e validados; operações passam por permissão e auditoria.
 * Entidades com regras próprias (empresas, SLA, tabelas de preço, calendários) têm telas específicas.
 */
export type FieldType = "text" | "textarea" | "int" | "decimal" | "bool" | "date" | "select" | "lookup" | "tags";

export interface ConfigField {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  lookup?: { entity: string; labelField: string; where?: Record<string, unknown> };
  hint?: string;
  list?: boolean;
}

export interface ConfigEntity {
  key: string;
  model: string; // nome do delegate Prisma (camelCase)
  title: string;
  description: string;
  group: string;
  fields: ConfigField[];
  hasActive?: boolean;
  orderBy?: Record<string, "asc" | "desc">;
  unique?: string[];
}

const MODELS = [
  { value: "FIXED_PRICE", label: "Preço fechado" }, { value: "TIME_MATERIAL", label: "Time & material" }, { value: "MONTHLY_ALLOCATION", label: "Alocação mensal" },
  { value: "HOUR_PACKAGE", label: "Pacote de horas" }, { value: "AMS_RECURRING", label: "AMS recorrente" }, { value: "ADVISORY", label: "Advisory" },
  { value: "TRAINING", label: "Treinamento" }, { value: "HYBRID", label: "Híbrido" },
];

export const CONFIG_ENTITIES: ConfigEntity[] = [
  {
    key: "servicos", model: "service", title: "Serviços e catálogo", group: "Comercial", description: "Tipos de serviço oferecidos e conta de receita gerencial.",
    unique: ["code"], hasActive: true, orderBy: { code: "asc" },
    fields: [
      { name: "code", label: "Código", type: "text", required: true, list: true },
      { name: "name", label: "Nome", type: "text", required: true, list: true },
      { name: "category", label: "Categoria", type: "select", required: true, list: true, options: [
        { value: "IMPLEMENTATION", label: "Implementação" }, { value: "CONSULTING", label: "Consultoria" }, { value: "ALLOCATION", label: "Alocação" },
        { value: "AMS", label: "AMS" }, { value: "ADVISORY", label: "Advisory" }, { value: "TRAINING", label: "Treinamento" }, { value: "OTHER", label: "Outro" }] },
      { name: "defaultModel", label: "Modelo comercial padrão", type: "select", options: MODELS, list: true },
      { name: "revenueAccountId", label: "Conta de receita", type: "lookup", lookup: { entity: "managerialAccount", labelField: "name", where: { type: "REVENUE" } } },
      { name: "description", label: "Descrição", type: "textarea" },
    ],
  },
  {
    key: "funil", model: "pipelineStage", title: "Etapas do funil", group: "Comercial", description: "Etapas do CRM com probabilidade padrão.",
    hasActive: true, orderBy: { order: "asc" },
    fields: [
      { name: "name", label: "Nome", type: "text", required: true, list: true },
      { name: "order", label: "Ordem", type: "int", required: true, list: true },
      { name: "probability", label: "Probabilidade (%)", type: "int", required: true, list: true },
      { name: "kind", label: "Tipo", type: "select", required: true, list: true, options: [{ value: "OPEN", label: "Aberta" }, { value: "WON", label: "Ganha" }, { value: "LOST", label: "Perdida" }] },
    ],
  },
  { key: "motivos-perda", model: "lossReason", title: "Motivos de perda", group: "Comercial", description: "Motivos para oportunidades perdidas.", hasActive: true, orderBy: { name: "asc" }, fields: [{ name: "name", label: "Motivo", type: "text", required: true, list: true }] },
  {
    key: "comissoes", model: "commissionRule", title: "Regras de comissão", group: "Comercial", description: "Base (contratação, faturamento ou recebimento) e percentual por beneficiário.", hasActive: true,
    fields: [
      { name: "name", label: "Nome", type: "text", required: true, list: true },
      { name: "basis", label: "Base", type: "select", required: true, list: true, options: [{ value: "BOOKING", label: "Contratação" }, { value: "INVOICE", label: "Faturamento" }, { value: "RECEIPT", label: "Recebimento" }] },
      { name: "ratePct", label: "Percentual (%)", type: "decimal", required: true, list: true },
      { name: "beneficiaryPartyId", label: "Parceiro/canal beneficiário", type: "lookup", lookup: { entity: "party", labelField: "name", where: { isPartner: true } } },
      { name: "appliesToKind", label: "Aplica-se a", type: "select", options: [{ value: "NEW", label: "Novos negócios" }, { value: "RENEWAL", label: "Renovações" }, { value: "UPSELL", label: "Upsell" }, { value: "CROSS_SELL", label: "Cross-sell" }] },
    ],
  },
  { key: "tipos-projeto", model: "projectType", title: "Tipos de projeto", group: "Operação", description: "Tipos e modelos de WBS.", hasActive: true, orderBy: { name: "asc" },
    fields: [
      { name: "name", label: "Nome", type: "text", required: true, list: true },
      { name: "templateKey", label: "Modelo de WBS", type: "select", list: true, options: ["ERP_IMPLEMENTATION", "DIAGNOSTIC", "ROLLOUT", "INTEGRATION", "TRAINING", "ADVISORY", "ALLOCATION", "AMS"].map((k) => ({ value: k, label: k })) },
    ] },
  { key: "papeis", model: "teamRole", title: "Papéis de equipe", group: "Operação", description: "Papéis usados em propostas, tarifas e alocações.", hasActive: true, orderBy: { name: "asc" }, fields: [{ name: "name", label: "Papel", type: "text", required: true, list: true }] },
  { key: "senioridades", model: "seniorityLevel", title: "Senioridades", group: "Operação", description: "Níveis de senioridade.", orderBy: { order: "asc" }, fields: [{ name: "name", label: "Nome", type: "text", required: true, list: true }, { name: "order", label: "Ordem", type: "int", required: true, list: true }] },
  { key: "competencias", model: "skill", title: "Competências", group: "Operação", description: "Competências técnicas e funcionais (SAP e outras tecnologias).", unique: ["name"], hasActive: true, orderBy: { name: "asc" },
    fields: [{ name: "name", label: "Competência", type: "text", required: true, list: true }, { name: "category", label: "Categoria", type: "text", list: true }] },
  {
    key: "categorias-despesa", model: "expenseCategory", title: "Categorias de despesa", group: "Operação", description: "Categorias, conta gerencial e padrões de reembolso/cobrança.", hasActive: true, orderBy: { name: "asc" },
    fields: [
      { name: "name", label: "Nome", type: "text", required: true, list: true },
      { name: "accountId", label: "Conta gerencial", type: "lookup", lookup: { entity: "managerialAccount", labelField: "name" } },
      { name: "reimbursableDefault", label: "Reembolsável ao profissional por padrão", type: "bool", list: true },
      { name: "billableDefault", label: "Cobrável do cliente por padrão", type: "bool", list: true },
      { name: "maxAmount", label: "Limite por lançamento", type: "decimal" },
    ],
  },
  {
    key: "plano-contas", model: "managerialAccount", title: "Plano de contas gerencial", group: "Controladoria", description: "Contas da DRE gerencial. Contas com chave de sistema são usadas pelas integrações internas.", unique: ["code"], hasActive: true, orderBy: { code: "asc" },
    fields: [
      { name: "code", label: "Código", type: "text", required: true, list: true },
      { name: "name", label: "Nome", type: "text", required: true, list: true },
      { name: "type", label: "Tipo", type: "select", required: true, list: true, options: [
        { value: "REVENUE", label: "Receita" }, { value: "DEDUCTION", label: "Dedução" }, { value: "DIRECT_COST", label: "Custo direto" },
        { value: "OPERATING_EXPENSE", label: "Despesa operacional" }, { value: "FINANCIAL", label: "Financeiro" }, { value: "OTHER", label: "Outros" }] },
      { name: "parentId", label: "Conta superior", type: "lookup", lookup: { entity: "managerialAccount", labelField: "name" } },
    ],
  },
  { key: "centros-custo", model: "costCenter", title: "Centros de custo", group: "Controladoria", description: "Centros de custo por empresa.", unique: ["code"], hasActive: true, orderBy: { code: "asc" },
    fields: [
      { name: "code", label: "Código", type: "text", required: true, list: true },
      { name: "name", label: "Nome", type: "text", required: true, list: true },
      { name: "companyId", label: "Empresa", type: "lookup", lookup: { entity: "company", labelField: "legalName" }, list: true },
      { name: "kind", label: "Natureza", type: "select", list: true, options: [{ value: "OPERATIONAL", label: "Operacional" }, { value: "ADMINISTRATIVE", label: "Administrativo" }, { value: "COMMERCIAL", label: "Comercial" }] },
    ] },
  { key: "unidades", model: "businessUnit", title: "Unidades de negócio", group: "Controladoria", description: "Unidades de negócio por empresa.", unique: ["code"], hasActive: true,
    fields: [
      { name: "code", label: "Código", type: "text", required: true, list: true },
      { name: "name", label: "Nome", type: "text", required: true, list: true },
      { name: "companyId", label: "Empresa", type: "lookup", required: true, lookup: { entity: "company", labelField: "legalName" }, list: true },
    ] },
  { key: "metodos-pagamento", model: "paymentMethod", title: "Métodos de pagamento", group: "Financeiro", description: "Boleto, PIX, transferência…", hasActive: true, fields: [{ name: "name", label: "Nome", type: "text", required: true, list: true }] },
  {
    key: "alcadas", model: "approvalRule", title: "Regras de aprovação (alçadas)", group: "Governança",
    description: "Exigem aprovação por tipo de documento, empresa, valor, desconto ou margem. A permissão indicada define quem aprova.", hasActive: true, orderBy: { docType: "asc" },
    fields: [
      { name: "docType", label: "Documento", type: "select", required: true, list: true, options: [
        { value: "PROPOSAL", label: "Proposta" }, { value: "PURCHASE_ORDER", label: "Pedido de compra" }, { value: "REQUISITION", label: "Requisição" }, { value: "EXPENSE", label: "Despesa" },
        { value: "PAYABLE", label: "Conta a pagar" }, { value: "MEASUREMENT", label: "Medição" }, { value: "CONTRACT_AMENDMENT", label: "Aditivo" }] },
      { name: "name", label: "Nome", type: "text", required: true, list: true },
      { name: "companyId", label: "Empresa (vazio = todas)", type: "lookup", lookup: { entity: "company", labelField: "legalName" } },
      { name: "minAmount", label: "Exigir se valor ≥", type: "decimal", list: true },
      { name: "maxDiscountPct", label: "Exigir se desconto > (%)", type: "decimal", list: true },
      { name: "minMarginPct", label: "Exigir se margem < (%)", type: "decimal", list: true },
      { name: "requiredPermission", label: "Permissão do aprovador", type: "select", required: true, list: true, options: [
        "proposal.approve", "proposal.approve_high", "purchase.approve", "expense.approve", "payable.approve", "billing.approve", "contract.approve"].map((p) => ({ value: p, label: p })) },
      { name: "level", label: "Nível", type: "int", required: true },
    ],
  },
  {
    key: "modelos-documento", model: "documentTemplate", title: "Modelos de documentos", group: "Governança", description: "Cabeçalho/rodapé e texto padrão de propostas, contratos e cobranças.", hasActive: true,
    fields: [
      { name: "type", label: "Tipo", type: "select", required: true, list: true, options: [{ value: "PROPOSAL", label: "Proposta" }, { value: "CONTRACT", label: "Contrato" }, { value: "BILLING_DOCUMENT", label: "Documento de cobrança" }, { value: "STATUS_REPORT", label: "Relatório de status" }] },
      { name: "name", label: "Nome", type: "text", required: true, list: true },
      { name: "header", label: "Cabeçalho", type: "textarea" },
      { name: "body", label: "Texto padrão", type: "textarea" },
      { name: "footer", label: "Rodapé", type: "textarea" },
    ],
  },
  {
    key: "campos-adicionais", model: "customFieldDef", title: "Campos adicionais", group: "Governança", description: "Campos simples, tipados e validados para clientes, projetos, contratos, oportunidades e chamados.", hasActive: true,
    fields: [
      { name: "entity", label: "Entidade", type: "select", required: true, list: true, options: [{ value: "PARTY", label: "Cliente/Fornecedor" }, { value: "PROJECT", label: "Projeto" }, { value: "CONTRACT", label: "Contrato" }, { value: "OPPORTUNITY", label: "Oportunidade" }, { value: "TICKET", label: "Chamado" }] },
      { name: "key", label: "Chave técnica", type: "text", required: true, list: true, hint: "Somente letras minúsculas, números e _" },
      { name: "label", label: "Rótulo", type: "text", required: true, list: true },
      { name: "type", label: "Tipo", type: "select", required: true, list: true, options: [{ value: "TEXT", label: "Texto" }, { value: "NUMBER", label: "Número" }, { value: "DATE", label: "Data" }, { value: "BOOLEAN", label: "Sim/Não" }, { value: "SELECT", label: "Lista" }] },
      { name: "options", label: "Opções (lista)", type: "tags", hint: "Separe por vírgula" },
      { name: "required", label: "Obrigatório", type: "bool", list: true },
    ],
  },
  {
    key: "retencoes", model: "withholdingRule", title: "Retenções (informadas pelo fiscal)", group: "Fiscal",
    description: "Retenções parametrizadas com vigência. O sistema não define alíquotas: informe conforme orientação do responsável fiscal.", hasActive: true,
    fields: [
      { name: "code", label: "Código", type: "text", required: true, list: true },
      { name: "name", label: "Nome", type: "text", required: true, list: true },
      { name: "ratePct", label: "Alíquota (%)", type: "decimal", required: true, list: true },
      { name: "minBaseAmount", label: "Base mínima", type: "decimal" },
      { name: "companyId", label: "Empresa (vazio = todas)", type: "lookup", lookup: { entity: "company", labelField: "legalName" } },
      { name: "validFrom", label: "Vigência inicial", type: "date", required: true, list: true },
      { name: "validTo", label: "Vigência final", type: "date", list: true },
      { name: "validatedBy", label: "Validado por (responsável fiscal)", type: "text", list: true },
    ],
  },
  {
    key: "codigos-fiscais", model: "fiscalServiceCode", title: "Códigos fiscais de serviço", group: "Fiscal",
    description: "Código de serviço por município e empresa, com vigência, informado e validado pelo responsável fiscal.",
    fields: [
      { name: "companyId", label: "Empresa", type: "lookup", required: true, lookup: { entity: "company", labelField: "legalName" }, list: true },
      { name: "serviceId", label: "Serviço", type: "lookup", required: true, lookup: { entity: "service", labelField: "name" }, list: true },
      { name: "municipalityCode", label: "Município (código IBGE)", type: "text", required: true, list: true },
      { name: "serviceCode", label: "Código do serviço", type: "text", required: true, list: true },
      { name: "issRatePct", label: "Alíquota ISS (%) informada", type: "decimal" },
      { name: "validFrom", label: "Vigência inicial", type: "date", required: true, list: true },
      { name: "validTo", label: "Vigência final", type: "date" },
      { name: "validatedBy", label: "Validado por", type: "text", list: true },
    ],
  },
];

export function getConfigEntity(key: string) {
  return CONFIG_ENTITIES.find((e) => e.key === key) ?? null;
}
