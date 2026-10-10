/**
 * Biblioteca de modelos de WBS (fases → itens) usados na criação de projetos.
 * `share` é o percentual do esforço do projeto atribuído ao item; a soma de cada modelo é 100.
 * Uma organização pode substituir o modelo de um tipo de projeto por um modelo próprio (ProjectType.wbsTemplate).
 */
export type WbsItemKind = "DELIVERABLE" | "TASK" | "MILESTONE";
export interface WbsItem { name: string; kind: WbsItemKind; share: number; acceptance?: boolean }
export interface WbsPhase { phase: string; items: WbsItem[] }
export type WbsTemplate = WbsPhase[];

const t = (name: string, share: number): WbsItem => ({ name, kind: "TASK", share });
const d = (name: string, share: number, acceptance = true): WbsItem => ({ name, kind: "DELIVERABLE", share, acceptance });
const m = (name: string, share: number, acceptance = false): WbsItem => ({ name, kind: "MILESTONE", share, acceptance });

export const WBS_TEMPLATES: Record<string, { label: string; phases: WbsTemplate }> = {
  // ---------------------------------------------------------------- Consultoria e TI (especialidade)
  ERP_IMPLEMENTATION: { label: "Implementação de sistemas (ERP)", phases: [
    { phase: "Preparação", items: [m("Kick-off", 2), d("Plano do projeto", 3)] },
    { phase: "Desenho da solução", items: [t("Workshops de processos", 10), d("Documento de desenho (BBP)", 10)] },
    { phase: "Realização", items: [t("Configuração", 25), t("Desenvolvimentos e integrações", 20), d("Testes integrados", 10)] },
    { phase: "Preparação final", items: [t("Treinamento de usuários", 8), t("Migração de dados", 7)] },
    { phase: "Go-live e suporte", items: [m("Go-live", 1, true), t("Suporte pós go-live", 4)] },
  ] },
  DIAGNOSTIC: { label: "Diagnóstico", phases: [
    { phase: "Levantamento", items: [t("Entrevistas", 40), d("Mapeamento AS-IS", 25)] },
    { phase: "Recomendações", items: [d("Relatório de diagnóstico", 30), m("Apresentação executiva", 5)] },
  ] },
  ROLLOUT: { label: "Rollout", phases: [
    { phase: "Análise de localização", items: [d("Gap analysis local", 20)] },
    { phase: "Adaptação", items: [t("Configuração local", 40), t("Testes", 20)] },
    { phase: "Go-live", items: [m("Cutover", 10, true), t("Hypercare", 10)] },
  ] },
  INTEGRATION: { label: "Integração de sistemas", phases: [
    { phase: "Especificação", items: [d("Especificação de interfaces", 20)] },
    { phase: "Construção", items: [t("Desenvolvimento", 50), d("Testes de integração", 20)] },
    { phase: "Implantação", items: [m("Produção", 10)] },
  ] },
  TRAINING: { label: "Treinamento", phases: [
    { phase: "Preparação", items: [d("Material didático", 40)] },
    { phase: "Execução", items: [t("Turmas", 50), d("Avaliação de reação", 10, false)] },
  ] },
  ADVISORY: { label: "Advisory / aconselhamento", phases: [{ phase: "Aconselhamento", items: [t("Sessões de advisory", 80), d("Relatório executivo", 20)] }] },
  ALLOCATION: { label: "Alocação de profissionais", phases: [{ phase: "Alocação", items: [t("Atividades alocadas", 100)] }] },
  AMS: { label: "Sustentação / serviço recorrente", phases: [{ phase: "Sustentação", items: [t("Atendimento de chamados", 90), d("Relatório mensal de SLA", 10, false)] }] },

  // ---------------------------------------------------------------- Genéricos e outros setores
  GENERIC_PROJECT: { label: "Projeto genérico", phases: [
    { phase: "Iniciação", items: [m("Início", 2), d("Plano de trabalho", 8)] },
    { phase: "Execução", items: [t("Execução", 70), d("Entrega", 10)] },
    { phase: "Encerramento", items: [m("Aceite final", 5, true), t("Encerramento", 5)] },
  ] },
  STRATEGY: { label: "Planejamento estratégico / transformação", phases: [
    { phase: "Diagnóstico", items: [t("Entrevistas e análise", 20), d("Diagnóstico", 10)] },
    { phase: "Formulação", items: [t("Oficinas de estratégia", 20), d("Plano estratégico", 15)] },
    { phase: "Desdobramento", items: [d("Plano de ação e indicadores", 15), t("Acompanhamento da implantação", 20)] },
  ] },
  ENGINEERING_DESIGN: { label: "Projeto de engenharia / arquitetura", phases: [
    { phase: "Levantamentos", items: [t("Levantamento de campo", 10), d("Programa de necessidades", 5)] },
    { phase: "Estudo preliminar", items: [d("Estudo preliminar", 15)] },
    { phase: "Anteprojeto", items: [d("Anteprojeto", 20)] },
    { phase: "Projeto executivo", items: [t("Compatibilização de disciplinas", 15), d("Projeto executivo", 30)] },
    { phase: "Entrega", items: [m("Aprovação do cliente", 5, true)] },
  ] },
  FEASIBILITY: { label: "Estudo de viabilidade", phases: [
    { phase: "Levantamento", items: [t("Coleta de dados", 35)] },
    { phase: "Análise", items: [t("Análises técnicas e econômicas", 40), d("Relatório de viabilidade", 25)] },
  ] },
  WORKS_MANAGEMENT: { label: "Gerenciamento / fiscalização de obra", phases: [
    { phase: "Mobilização", items: [m("Mobilização", 5), d("Plano de gerenciamento", 5)] },
    { phase: "Acompanhamento", items: [t("Visitas e fiscalização", 60), d("Relatórios periódicos", 20, false)] },
    { phase: "Encerramento", items: [d("Termo de recebimento", 10)] },
  ] },
  TECHNICAL_REPORT: { label: "Laudo / parecer técnico", phases: [
    { phase: "Vistoria", items: [t("Vistoria e coleta", 40)] },
    { phase: "Elaboração", items: [t("Análise", 30), d("Laudo / parecer", 30)] },
  ] },
  CAMPAIGN: { label: "Campanha (agência)", phases: [
    { phase: "Briefing", items: [d("Briefing aprovado", 5)] },
    { phase: "Planejamento", items: [d("Planejamento e conceito", 15)] },
    { phase: "Criação e produção", items: [t("Criação", 30), d("Peças aprovadas", 20)] },
    { phase: "Veiculação", items: [t("Veiculação e acompanhamento", 20), d("Relatório de resultados", 10, false)] },
  ] },
  BRANDING: { label: "Branding / identidade visual", phases: [
    { phase: "Imersão", items: [t("Pesquisa e imersão", 20)] },
    { phase: "Conceito", items: [d("Plataforma de marca", 20)] },
    { phase: "Design", items: [t("Desenvolvimento visual", 35), d("Manual de identidade", 25)] },
  ] },
  WEBSITE: { label: "Site / produção digital", phases: [
    { phase: "Descoberta", items: [d("Arquitetura de informação", 10)] },
    { phase: "Design", items: [d("Layouts aprovados", 25)] },
    { phase: "Desenvolvimento", items: [t("Desenvolvimento", 45), d("Homologação", 10)] },
    { phase: "Publicação", items: [m("Publicação", 10, true)] },
  ] },
  RETAINER: { label: "Contrato recorrente (fee/retainer)", phases: [{ phase: "Atendimento recorrente", items: [t("Demandas do período", 90), d("Relatório do período", 10, false)] }] },
  MONTHLY_ROUTINE: { label: "Rotina mensal (escritório)", phases: [
    { phase: "Coleta", items: [t("Recebimento de documentos", 20)] },
    { phase: "Processamento", items: [t("Processamento e conferência", 50)] },
    { phase: "Entrega", items: [d("Entregas do período", 25, false), m("Fechamento do período", 5)] },
  ] },
  CASE: { label: "Caso / processo", phases: [
    { phase: "Análise", items: [t("Análise e estratégia", 20), d("Parecer inicial", 10)] },
    { phase: "Condução", items: [t("Atos e acompanhamento", 60)] },
    { phase: "Encerramento", items: [d("Relatório de encerramento", 10, false)] },
  ] },
  AUDIT: { label: "Auditoria", phases: [
    { phase: "Planejamento", items: [d("Plano de auditoria", 15)] },
    { phase: "Execução", items: [t("Testes e evidências", 55)] },
    { phase: "Relatório", items: [d("Relatório de auditoria", 25), m("Reunião de encerramento", 5)] },
  ] },
  INSTALLATION: { label: "Instalação / implantação em campo", phases: [
    { phase: "Planejamento", items: [t("Vistoria técnica", 10), d("Plano de instalação", 10)] },
    { phase: "Execução", items: [t("Instalação", 60), d("Testes e comissionamento", 15)] },
    { phase: "Entrega", items: [m("Termo de aceite", 5, true)] },
  ] },
  MAINTENANCE: { label: "Manutenção (preventiva/corretiva)", phases: [{ phase: "Manutenção", items: [t("Rotinas preventivas", 50), t("Atendimentos corretivos", 40), d("Relatório de manutenção", 10, false)] }] },
  SOFTWARE_DEVELOPMENT: { label: "Desenvolvimento de software", phases: [
    { phase: "Descoberta", items: [d("Backlog priorizado", 10)] },
    { phase: "Construção", items: [t("Sprints de desenvolvimento", 60), d("Homologação", 15)] },
    { phase: "Entrega", items: [m("Publicação em produção", 5, true), t("Estabilização", 10)] },
  ] },
  DISCOVERY: { label: "Discovery / UX", phases: [
    { phase: "Pesquisa", items: [t("Pesquisa com usuários", 40)] },
    { phase: "Definição", items: [d("Protótipos validados", 40), d("Recomendações", 20)] },
  ] },
  COURSE: { label: "Curso / turma", phases: [
    { phase: "Desenho", items: [d("Desenho instrucional", 20)] },
    { phase: "Produção", items: [d("Material do curso", 25)] },
    { phase: "Execução", items: [t("Aulas / encontros", 45), d("Avaliação dos participantes", 10, false)] },
  ] },
  EVENT: { label: "Evento", phases: [
    { phase: "Planejamento", items: [d("Plano do evento", 15)] },
    { phase: "Produção", items: [t("Contratações e logística", 40)] },
    { phase: "Realização", items: [m("Realização", 30, true), d("Relatório pós-evento", 15, false)] },
  ] },
};

export const WBS_TEMPLATE_OPTIONS = Object.entries(WBS_TEMPLATES).map(([value, v]) => ({ value, label: v.label }));

/** Soma dos percentuais de esforço de um modelo. */
export function wbsShareTotal(tpl: WbsTemplate) {
  return tpl.reduce((s, p) => s + p.items.reduce((a, i) => a + i.share, 0), 0);
}

/**
 * Formato de texto para modelo próprio (uma linha por item): `Fase | Item | tipo | % | aceite`.
 * tipo: tarefa, entregavel ou marco; aceite: "sim" quando exige aceite do cliente.
 */
export function parseWbsText(text: string): { template: WbsTemplate; errors: string[] } {
  const errors: string[] = [];
  const phases: WbsTemplate = [];
  const kinds: Record<string, WbsItemKind> = { tarefa: "TASK", entregavel: "DELIVERABLE", "entregável": "DELIVERABLE", marco: "MILESTONE" };
  text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).forEach((line, idx) => {
    const [phase, name, kind = "tarefa", share = "", acc = ""] = line.split("|").map((s) => s.trim());
    const k = kinds[kind.toLowerCase()];
    const n = Number(share.replace(",", "."));
    if (!phase || !name) errors.push(`Linha ${idx + 1}: informe fase e item.`);
    else if (!k) errors.push(`Linha ${idx + 1}: tipo deve ser tarefa, entregável ou marco.`);
    else if (!Number.isFinite(n) || n <= 0 || n > 100) errors.push(`Linha ${idx + 1}: percentual entre 0 e 100.`);
    else {
      let p = phases.find((x) => x.phase === phase);
      if (!p) phases.push((p = { phase, items: [] }));
      p.items.push({ name, kind: k, share: n, ...(["sim", "s", "x", "yes"].includes(acc.toLowerCase()) ? { acceptance: true } : {}) });
    }
  });
  if (!errors.length && !phases.length) errors.push("Informe ao menos um item.");
  if (!errors.length && Math.abs(wbsShareTotal(phases) - 100) > 0.001) errors.push(`A soma dos percentuais deve ser 100 (atual: ${wbsShareTotal(phases)}).`);
  return { template: phases, errors };
}

export function wbsToText(tpl: WbsTemplate) {
  const kind = { TASK: "tarefa", DELIVERABLE: "entregável", MILESTONE: "marco" } as const;
  return tpl.flatMap((p) => p.items.map((i) => [p.phase, i.name, kind[i.kind], String(i.share), i.acceptance ? "sim" : ""].join(" | ").replace(/ \| $/, ""))).join("\n");
}
