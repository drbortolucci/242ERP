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

## Situação (versão 1.0.0)
Etapas 1 a 9 implementadas e validadas (ver matriz). Itens remanescentes:

| Item | Tipo |
|------|------|
| Cenários de fluxo de caixa (otimista/pessimista) | ⏳ Pendente |
| P&L por cliente/contrato na interface (o serviço de DRE já aceita filtro por cliente) | ⏳ Pendente |
| SSO corporativo (OIDC/SAML) | ⏳ Pendente |
| Política de conteúdo (CSP) estrita | ⏳ Pendente |
| Provedor real de cobrança de assinaturas SaaS | 🔌 Externo |
| Provedor de NFS-e homologado + validação do responsável fiscal | 🔌 Externo |
| E-mail transacional real | 🔌 Externo |
| Assinatura eletrônica certificada | 🔌 Externo |
| Integração bancária automática (API/CNAB) | 🔌 Externo |
| Conversão cambial (multimoeda) | ⏳ Pendente |
| Atualizar Next/React quando corrigirem a retomada de hidratação após suspensão no shell (ver nota abaixo) | ⏳ Dependência |

**Nota técnica — hidratação.** No Next 15.5 (React canary embutido), quando a hidratação suspende dentro do shell (payload RSC ainda chegando), o React pode retomar com o cursor já avançado e emitir o erro recuperável #418. Ocorria de forma intermitente em páginas muito grandes (a tela de perfis tinha ~520 KB). Mitigação adotada: páginas leves (perfis passou a renderizar um perfil por vez); 480 carregamentos em 12 telas sem erro. Um limite de Suspense acima do shell elimina o erro, mas faz o Next transmitir a página (403/404 viram 200) ou deixa transições de Server Actions pendentes — por isso não foi adotado. Mantenha telas abaixo de ~150 KB de HTML (pagine listas e evite repetir formulários extensos por linha). Observação de 10/2026: ainda ocorre ocasionalmente na **primeira** carga de uma tela logo após o servidor iniciar (aquecimento), sem efeito para o usuário (o React recupera); 0 ocorrências em 20 cargas seguidas de /app/projetos (57 KB). O E2E repete uma vez em CI.

