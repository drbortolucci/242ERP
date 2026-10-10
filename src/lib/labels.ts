/** Rótulos pt-BR e tons de cor para estados e enumerações. */
const LABELS: Record<string, string> = {
  // genéricos
  DRAFT: "Rascunho", PENDING: "Pendente", PENDING_APPROVAL: "Aguardando aprovação", APPROVED: "Aprovado", REJECTED: "Rejeitado",
  CANCELED: "Cancelado", ACTIVE: "Ativo", INACTIVE: "Inativo", OPEN: "Aberto", CLOSED: "Fechado", DONE: "Concluído", SUBMITTED: "Enviado",
  POSTED: "Efetivado", REVERSED: "Estornado", DELIVERED: "Entregue", REGISTERED: "Registrada", PAID: "Pago", PARTIAL: "Parcial", ISSUED: "Emitido",
  // organização
  TRIAL: "Em avaliação", PAST_DUE: "Inadimplente", SUSPENDED: "Suspensa", TRIALING: "Em avaliação",
  // CRM/proposta
  NEW: "Novo", QUALIFIED: "Qualificado", DISQUALIFIED: "Desqualificado", CONVERTED: "Convertido", WON: "Ganha", LOST: "Perdida",
  SENT: "Enviada", ACCEPTED: "Aceita", EXPIRED: "Expirada", SUPERSEDED: "Substituída", CONTRACTED: "Contratado",
  // contratos/projetos
  ENDED: "Encerrado", PLANNING: "Planejamento", ON_HOLD: "Pausado", COMPLETED: "Concluído", TODO: "A fazer", IN_PROGRESS: "Em andamento", BLOCKED: "Bloqueado",
  READY: "Pronto", BILLED: "Faturado", MITIGATING: "Mitigando",
  // alocação/horas
  TENTATIVE: "Provisória", CONFIRMED: "Confirmada", NOT_REQUIRED: "Não exigida", NOT_BILLABLE: "Não faturável", ELIGIBLE: "Elegível",
  MEASURED: "Medido", INVOICED: "Faturado", FULFILLED: "Atendida", REQUESTED: "Solicitado", SETTLED: "Prestado contas",
  // compras
  QUOTING: "Em cotação", ORDERED: "Pedido emitido", PARTIALLY_RECEIVED: "Recebido parcial", RECEIVED: "Recebido", DIVERGENT: "Divergente",
  // AMS
  WAITING_CUSTOMER: "Aguardando cliente", WAITING_THIRD_PARTY: "Aguardando terceiro", RESOLVED: "Resolvido",
  INCIDENT: "Incidente", REQUEST: "Solicitação", PROBLEM: "Problema", CHANGE: "Mudança",
  // faturamento
  CLIENT_PENDING: "Aguardando cliente", CLIENT_APPROVED: "Aprovado pelo cliente", PARTIALLY_INVOICED: "Faturado parcial",
  NOT_REQUESTED: "Não solicitada", AUTHORIZED: "Autorizada", PROCESSING: "Processando", ERROR: "Erro",
  WRITTEN_OFF: "Baixado (perda)", RECONCILED: "Conciliado", IGNORED: "Ignorado", APPLIED: "Aplicado",
  // modelos
  FIXED_PRICE: "Preço fechado", TIME_MATERIAL: "Time & material", MONTHLY_ALLOCATION: "Alocação mensal", HOUR_PACKAGE: "Pacote de horas",
  AMS_RECURRING: "Recorrente com franquia (AMS, manutenção, fee)", ADVISORY: "Advisory", TRAINING: "Treinamento", HYBRID: "Híbrido",
  // vínculo
  CLT: "CLT", PJ: "PJ", PARTNER: "Parceiro", OTHER: "Outro",
  GREEN: "Verde", YELLOW: "Amarelo", RED: "Vermelho",
};
export function statusLabel(s: string) {
  return LABELS[s] ?? s;
}

type Tone = "slate" | "green" | "amber" | "red" | "blue" | "violet";
const GREEN = ["DELIVERED", "APPROVED", "ACTIVE", "PAID", "WON", "ACCEPTED", "DONE", "COMPLETED", "CONFIRMED", "AUTHORIZED", "RECONCILED", "CLIENT_APPROVED", "INVOICED", "RECEIVED", "RESOLVED", "CLOSED", "POSTED", "CONTRACTED", "GREEN", "BILLED", "SETTLED", "FULFILLED", "ELIGIBLE", "APPLIED"];
const AMBER = ["PENDING", "PENDING_APPROVAL", "SUBMITTED", "PARTIAL", "TENTATIVE", "TRIAL", "TRIALING", "WAITING_CUSTOMER", "WAITING_THIRD_PARTY", "CLIENT_PENDING", "PARTIALLY_RECEIVED", "PARTIALLY_INVOICED", "QUOTING", "ON_HOLD", "YELLOW", "PROCESSING", "MEASURED", "REQUESTED", "MITIGATING", "READY"];
const RED = ["REJECTED", "CANCELED", "LOST", "PAST_DUE", "SUSPENDED", "DIVERGENT", "BLOCKED", "EXPIRED", "RED", "ERROR", "REVERSED", "WRITTEN_OFF"];
const BLUE = ["REGISTERED", "OPEN", "NEW", "IN_PROGRESS", "SENT", "ISSUED", "ORDERED", "PLANNING", "QUALIFIED", "TODO"];
export function statusTone(s: string): Tone {
  if (GREEN.includes(s)) return "green";
  if (AMBER.includes(s)) return "amber";
  if (RED.includes(s)) return "red";
  if (BLUE.includes(s)) return "blue";
  return "slate";
}

export const COMMERCIAL_MODELS = ["FIXED_PRICE", "TIME_MATERIAL", "MONTHLY_ALLOCATION", "HOUR_PACKAGE", "AMS_RECURRING", "ADVISORY", "TRAINING", "HYBRID"] as const;
export const options = (keys: readonly string[]) => keys.map((k) => ({ value: k, label: statusLabel(k) }));
