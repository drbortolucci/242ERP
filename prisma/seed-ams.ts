/**
 * AMS de demonstração (via serviços): chamados dos últimos meses com SLA em horário comercial (incluindo pausas,
 * violações, reabertura e problema), horas apontadas e aprovadas que consomem a franquia (FIFO) e geram excedente,
 * chamado aberto pelo cliente no portal e base de conhecimento.
 */
import { prisma } from "../src/server/db";
import type { DemoContext } from "./seed-demo";
import { openTicket, changeStatus, addComment, assignTicket, linkProblem, rateTicket, slaSweep } from "../src/modules/ams/tickets";
import { saveArticle } from "../src/modules/ams/knowledge";
import { syncHourBank } from "../src/modules/ams/hour-bank";
import { createTimeEntry, submitEntries, approveEntries } from "../src/modules/timesheet/service";
import { zonedInstant } from "../src/domain/sla";
import { addDays, addMonths, monthStart, weekday } from "../src/lib/dates";

const TOPICS: [string, string, string, string][] = [
  ["Erro na emissão de NF de saída", "SAP", "SD", "Fiscal"], ["Usuário bloqueado após troca de senha", "SAP", "BC", "Acesso"], ["Relatório de vendas com divergência de totais", "SAP", "SD", "Relatórios"],
  ["Lançamento contábil não integrado", "SAP", "FI", "Integração"], ["Pedido travado por bloqueio de crédito", "SAP", "SD", "Crédito"], ["Nova regra de aprovação de compras", "SAP", "MM", "Configuração"],
  ["Lentidão no fechamento mensal", "SAP", "CO", "Desempenho"], ["Interface de estoque com falha intermitente", "Integração", "API", "Integração"], ["Criação de perfil de acesso para auditoria", "SAP", "BC", "Acesso"],
  ["Ajuste em layout de boleto", "SAP", "FI", "Formulários"],
];

export async function seedAms(d: DemoContext) {
  const mgr = d.users.ams.ctx;
  const T = d.today;
  const tz = mgr.timezone;
  const contractId = d.refs.ams;
  const gabriela = d.professionals["Gabriela"];
  const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
  const at = (day: string, hh: number, mm = 0) => zonedInstant(day, hh * 60 + mm, tz);
  const workday = (day: string) => { let x = day; while ([0, 6].includes(weekday(x))) x = addDays(x, 1); return x; };

  // Base de conhecimento
  const kb: [string, string, string, string, boolean][] = [
    ["Como desbloquear usuário no SAP", "1. Acesse a transação de administração de usuários.\n2. Informe o usuário e confirme o desbloqueio.\n3. Gere senha inicial e oriente a troca no primeiro acesso.", "SAP", "acesso, senha, bloqueio", true],
    ["Rejeição de NF por regra de validação fiscal", "Verifique o código de situação tributária do item e a regra de determinação do imposto. Consulte o responsável fiscal antes de alterar parâmetros — não altere alíquotas sem validação.", "SAP", "fiscal, nota, emissão", false],
    ["Pedido bloqueado por crédito", "Pedidos acima do limite são retidos. O desbloqueio exige aprovação do analista de crédito do cliente.", "SAP", "crédito, pedido, bloqueio", true],
    ["Checklist de fechamento mensal (CO)", "Executar apropriações, rateios e liquidações na ordem documentada. Lentidão costuma decorrer de execuções paralelas.", "SAP", "fechamento, desempenho", false],
    ["Monitoramento da interface de estoque", "Reprocessar mensagens com erro após corrigir o cadastro do material. Falhas intermitentes: verificar tempo limite do serviço.", "Integração", "interface, estoque, api", false],
  ];
  for (const [title, body, system, tags, clientVisible] of kb) await saveArticle(mgr, null, { title, body, system, tags, clientVisible, published: true });

  // Chamados: ~7 por mês nos últimos 3 meses + abertos recentes
  const entries: string[] = [];
  let seq = 0;
  let problemId: string | null = null;
  for (let m = 3; m >= 0; m--) {
    const base = m === 0 ? addDays(T, -8) : monthStart(addMonths(T, -m));
    const perMonth = m === 0 ? 4 : 7;
    for (let k = 0; k < perMonth; k++) {
      const day = workday(addDays(base, 1 + k * 3));
      if (day >= T) break;
      const [title, system, module, category] = TOPICS[seq % TOPICS.length];
      const impact = [2, 3, 1, 2, 3, 2, 3][k % 7];
      const urgency = [2, 3, 2, 1, 3, 3, 2][k % 7];
      const type = category === "Configuração" || category === "Acesso" ? "REQUEST" : "INCIDENT";
      const t = await openTicket(mgr, { partyId: contract.partyId, contractId, type, system, module, category, title, description: `${title}. Relatado pelo usuário-chave da área.`, impact, urgency, openedByContactName: "Aprovador Beta" }, at(day, 9, 30 + (k % 3) * 10));
      seq++;
      await assignTicket(mgr, t.id, gabriela, "Sustentação SAP");
      const isOpenRecent = m === 0 && k >= 1;
      // primeira resposta: em geral dentro do prazo; um caso por mês responde tarde
      await addComment(mgr, t.id, "Recebemos o chamado e iniciamos a análise.", "PUBLIC", at(day, k === 4 ? 14 : 10, 0));
      await changeStatus(mgr, t.id, "IN_PROGRESS", undefined, at(day, k === 4 ? 14 : 10, 5));
      if (isOpenRecent) {
        if (k === 1) await changeStatus(mgr, t.id, "WAITING_CUSTOMER", "Aguardando evidências do usuário", at(day, 15, 0));
        continue;
      }
      // pausa aguardando cliente em parte dos chamados
      let resolveDay = day;
      if (k % 3 === 1) {
        await changeStatus(mgr, t.id, "WAITING_CUSTOMER", "Solicitado print do erro", at(day, 11, 0));
        resolveDay = workday(addDays(day, 1));
        await changeStatus(mgr, t.id, "IN_PROGRESS", undefined, at(resolveDay, 10, 0));
      }
      // um chamado por mês resolvido após o prazo (violação de solução)
      if (k === 5) resolveDay = workday(addDays(resolveDay, 7));
      await addComment(mgr, t.id, "Ajuste aplicado e validado em qualidade. Favor confirmar.", "PUBLIC", at(resolveDay, 16, 0));
      await changeStatus(mgr, t.id, "RESOLVED", "Causa: parametrização", at(resolveDay, 16, 30));
      await changeStatus(mgr, t.id, "CLOSED", undefined, at(workday(addDays(resolveDay, 1)), 10, 0));
      await rateTicket(mgr, t.id, k === 5 ? 3 : 5 - (k % 2), k === 5 ? "Demorou mais que o esperado" : undefined);
      // horas: 1,5 a 6 h por chamado (registradas pela administração em nome da analista e aprovadas pela gestora AMS)
      const hours = ["2", "3.5", "1.5", "6", "4", "5.5", "2.5"][k % 7];
      const e = await createTimeEntry(d.admin, { professionalId: gabriela, date: resolveDay, hours, description: `${t.number}: ${title}`, activityType: "SUPPORT", billable: true, ticketId: t.id });
      entries.push(e.id);
      if (category === "Integração" && !problemId) {
        const p = await openTicket(mgr, { partyId: contract.partyId, contractId, type: "PROBLEM", system, module, category, title: "Falhas recorrentes de integração", description: "Problema aberto para análise de causa raiz das falhas recorrentes de integração.", impact: 2, urgency: 3 }, at(resolveDay, 17, 0));
        problemId = p.id;
        await assignTicket(mgr, p.id, gabriela, "Sustentação SAP");
      }
      if (problemId && category === "Integração") await linkProblem(mgr, t.id, problemId);
    }
  }
  // Mês com demanda acima da franquia: horas de melhoria em um chamado de requisição (gera excedente cobrável)
  const heavyMonth = monthStart(addMonths(T, -1));
  const big = await openTicket(mgr, { partyId: contract.partyId, contractId, type: "REQUEST", system: "SAP", module: "SD", category: "Melhoria", title: "Ajustes no processo de devolução", description: "Requisição de melhoria acordada com o cliente.", impact: 3, urgency: 3, openedByContactName: "Sponsor Beta" }, at(workday(addDays(heavyMonth, 2)), 9, 0));
  await assignTicket(mgr, big.id, gabriela, "Sustentação SAP");
  await changeStatus(mgr, big.id, "IN_PROGRESS", undefined, at(workday(addDays(heavyMonth, 2)), 9, 30));
  for (let i = 0; i < 22; i++) {
    const day = addDays(heavyMonth, 3 + i);
    if ([0, 6].includes(weekday(day)) || day >= T) continue;
    const e = await createTimeEntry(d.admin, { professionalId: gabriela, date: day, hours: "4", description: `${big.number}: desenvolvimento da melhoria`, activityType: "WORK", billable: true, ticketId: big.id });
    entries.push(e.id);
  }
  await changeStatus(mgr, big.id, "RESOLVED", "Melhoria entregue", at(workday(addDays(heavyMonth, 20)), 17, 0));

  // Chamado aberto pelo cliente no portal (Beta)
  const portal = d.users.portalBeta.ctx;
  await openTicket(portal, { type: "INCIDENT", title: "Não consigo imprimir o romaneio", description: "Ao imprimir o romaneio de carga, a impressora não recebe o documento.", impact: 2, urgency: 2, system: "SAP", module: "SD" }, at(workday(addDays(T, -1)), 11, 0));

  // Envio e aprovação (aprovação dispara a apuração do banco de horas)
  await submitEntries(d.admin, entries);
  await approveEntries(mgr, entries);
  await syncHourBank(mgr, contractId);
  await slaSweep(new Date(), d.orgId);
}
