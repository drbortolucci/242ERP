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
