# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) · Versionamento semântico.

## [0.1.0] — Etapa 1: Fundação SaaS
### Adicionado
- Modelo de dados completo (todas as etapas) e migração inicial.
- Isolamento multi-tenant por construção (cliente Prisma escopado por organização e empresa).
- Autenticação (argon2id, sessão httpOnly, bloqueio, recuperação de acesso, convites, MFA TOTP, rate limit).
- Perfis e permissões por ação/módulo, alçadas de aprovação, segregação de funções, auditoria.
- Organizações, planos, avaliação, limites no servidor, upgrade/downgrade, cancelamento/reativação, retenção, política de inadimplência, webhooks idempotentes (provedor simulado).
- Onboarding salvável, empresas/filiais, unidades, centros de custo, contas bancárias, calendários e feriados.
- Configurador central, cadastros básicos, importação por planilha com prévia de erros, exportação CSV/XLSX.
- Anexos com validação por conteúdo, exportação integral de dados, acesso de suporte temporário.
- Painel da plataforma (métricas, organizações, planos).
- CI (lint, tipos, testes, migrações, seed, build, E2E) e Docker Compose.

## [0.2.0] — Etapa 2: Comercial
### Adicionado
- CRM: leads (qualificação e conversão), oportunidades multi-serviço, funil kanban/lista, atividades e interações, indicadores (pipeline bruto/ponderado, conversão, ciclo, sem atividade, previsão, vendas por responsável/cliente/serviço).
- Propostas versionadas com precificação (receita, custos, MC, markup), alçadas de aprovação com SoD, imutabilidade da versão aprovada, PDF, registro de aceite.
- Pedidos de venda (carteira), contratos com snapshot de itens/tarifas, reajuste com vigência, marcos, OCs do cliente, mudanças de escopo e aditivos aprovados, saldos (contratado/executado/faturado/recebido/disponível), alertas, renovação/upsell, comissões.
- Visão 360° do cliente.

## [0.3.0] — Etapa 3: Operação
### Adicionado
- Projetos vinculados a contrato com linha de base versionada (distribuição mensal), WBS gerada por modelos (implementação, diagnóstico, rollout, integração, treinamento, advisory, alocação, AMS), dependências, kanban, Gantt, riscos/problemas/decisões/pendências, relatórios de status, aceites de entregáveis, ETC e previsão ao término, EVM condicional, encerramentos operacional e financeiro separados; portfólio com sinais de risco.
- Recursos: solicitações, sugestões por competência/disponibilidade, alocação por %/horas por dia/total de horas convertida em horas pelo calendário, conflitos e exceções autorizadas, grade semanal/mensal de capacidade x alocado x apontado x faturável.
- Horas: fluxo rascunho→enviado→aprovado (interno)→cliente→elegível, rejeição com motivo, limites, duplicidade, hora extra, períodos fechados, snapshots de custo/tarifa, ajustes rastreáveis.
- Despesas: custo x devido ao profissional x cobrável, comprovante obrigatório, alçadas, conta a pagar de reembolso, adiantamentos e prestação de contas.
- Minha área (portal do consultor).

## [0.4.0] — Etapa 4: Suprimentos
### Adicionado
- Requisições com verificação de orçamento (projeto/centro de custo), cotações e mapa comparativo (menor preço total, prazo e por item).
- Pedidos de compra e contratações (avulsa, subcontratação, profissional PJ, recorrente com vigência, licença), alçadas com SoD, adiantamento ao fornecedor, cancelamento e encerramento de saldo.
- Recebimentos/aceites de serviço e devoluções; conferência de 3 vias com tolerância; tratamento de divergência (aceite justificado com SoD ou recusa); contas a pagar geradas para aprovação financeira.
- Ativos, licenças, assinaturas e materiais com movimentações e alertas de renovação.
- Visão 360° do fornecedor; documentação de conformidade com validade; avaliações.
- Apropriação no projeto: terceiros pela NF aprovada, PJ pelas horas (sem duplicidade), compromissos abertos.
### Corrigido
- Comprometido do projeto: pedidos encerrados liberam saldo e o saldo por pedido nunca é negativo.

## [0.5.0] — Etapa 5: AMS
### Adicionado
- Chamados (incidente, requisição, problema, mudança) com prioridade por impacto × urgência, SLA de resposta e solução em minutos úteis (calendário, janela de atendimento, feriados, fuso), pausas, escalonamento, violação, reabertura, encerramento automático, vínculo a problema e satisfação.
- Base de conhecimento (interna/visível ao cliente) com busca e sugestão de artigos no chamado.
- Banco de horas: franquias mensais (não acumula, acumula por N meses, pré-pago), consumo FIFO por vencimento, excedente valorizado com política (cobrar, exigir aprovação, absorver), expiração, ajustes e compras pré-pagas, alerta de saldo baixo.
- Apuração automática na aprovação de horas e diária pelo worker; varredura de SLA a cada 5 minutos; contexto de sistema auditado para tarefas agendadas.
- Horas apontadas no chamado compõem o custo do projeto de sustentação do contrato.

## [0.6.0] — Etapa 6: Monetização e financeiro
### Adicionado
- Motor de medição com origem rastreável (horas, marcos, mensalidades de alocação e AMS, excedente AMS, despesas, ajustes) e trava única por origem no banco; aprovação interna (SoD) e do cliente.
- Documento de cobrança com faturamento parcial, desconto, OC do cliente com controle de saldo, retenções configuradas pela empresa, parcelas pela condição de pagamento, PDF interno (não fiscal), cancelamento controlado e comissões por faturamento.
- Adaptador de NFS-e com provedor simulado, idempotência, tentativas e webhook autenticado.
- Contas a receber/pagar: títulos avulsos, aprovação de CP com SoD, liquidação parcial com juros/multa/desconto, estorno vinculado, adiantamentos e aplicação, compensação autorizada, aging, contas recorrentes (job), comissões por recebimento.
- Tesouraria: saldos, transferências, importação de extrato CSV/OFX sem duplicidade, conciliação 1:1, lançamento de tarifas, fluxo de caixa realizado e previsto.
- Job `contracts.alerts` (agendado e antes sem manipulador) passa a notificar os responsáveis.

