# Backlog por etapas

Legenda de situação: ✅ Implementado e validado · 🟡 Implementado com restrições · 🔌 Dependente de integração externa · ⏳ Pendente

A situação detalhada e as evidências estão em [MATRIZ_REQUISITOS.md](MATRIZ_REQUISITOS.md); o histórico em [PROGRESSO.md](PROGRESSO.md).

## Etapa 1 — Fundação SaaS
- Repositório, CI (lint, tipos, testes, migrações, build), Docker Compose, `.env.example`
- Modelo de dados completo e migração inicial
- Autenticação (argon2id, sessão httpOnly, bloqueio por tentativas, recuperação de acesso, MFA TOTP)
- Isolamento de tenant por construção e escopo de empresas
- Perfis/permissões, alçadas, segregação de funções, auditoria
- Organizações, planos, trial, limites no servidor, convites
- Onboarding (assistente salvável/retomável), empresas, filiais, unidades, centros de custo, contas bancárias
- Configurador central e cadastros básicos (com importação por planilha)

## Etapa 2 — Comercial
- CRM: leads, contas, contatos, oportunidades (multi-serviço), funil kanban/lista, atividades, indicadores
- Propostas versionadas, precificação (receita, custo, margem de contribuição, markup), alçadas, PDF, aceite
- Pedido de venda, contrato (tarifas snapshot, OC do cliente, aditivos, mudanças de escopo), comissões, alertas
- Visão 360° do cliente

## Etapa 3 — Operação
- Projetos (WBS, dependências, marcos, linha de base versionada, riscos/problemas/decisões, status report, aceites, ETC)
- Portfólio, kanban, Gantt
- Recursos: profissionais, custo/hora com vigência, ausências, solicitações, alocações, conflitos, capacidade
- Horas: fluxo completo, aprovação interna/cliente, elegibilidade, ajustes rastreáveis
- Despesas e adiantamentos

## Etapa 4 — Suprimentos
- Requisição → cotação → mapa comparativo → aprovação → pedido → aceite/recebimento → documento do fornecedor (conferência 3 vias) → contas a pagar
- Ativos/licenças, avaliação de fornecedores, visão 360° do fornecedor

## Etapa 5 — AMS
- Chamados, SLA em horário comercial com pausas, escalação, base de conhecimento
- Franquia, banco de horas, pré-pago, excedente (razão de saldo FIFO)

## Etapa 6 — Monetização e financeiro
- Motor de medição (todas as origens), pré-fatura, aprovação, documento de cobrança, faturamento parcial, retenções
- NFS-e (adaptador + simulado), contas a receber/pagar, liquidações, estornos, adiantamentos, compensações
- Tesouraria: contas, transferências, importação de extrato, conciliação, fluxo de caixa realizado/previsto, cenários

## Etapa 7 — Controladoria
- Razão gerencial, reconhecimento de receita, orçamento/forecast, rateios versionados, DRE, P&L por projeto/contrato/cliente/unidade, fechamento/reabertura, exportação contábil, importação de folha

## Etapa 8 — Portais e gestão
- Portal do cliente, portal do consultor, dashboards por perfil, indicadores rastreáveis

## Etapa 9 — Integrações e produção
- Assinatura SaaS (provedor + webhooks), adaptadores, API externa, observabilidade, checklist de produção
