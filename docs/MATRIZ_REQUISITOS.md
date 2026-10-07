# Matriz de requisitos e critérios de aceite

Legenda: ✅ Implementado e validado · 🟡 Implementado com restrições · 🔌 Dependente de integração externa · ⏳ Pendente

## Critérios de aceite obrigatórios (seção 34)

| # | Critério | Como é verificado | Etapa | Situação | Evidência |
|---|----------|-------------------|-------|----------|-----------|
| AC01 | Criar uma organização SaaS | Cadastro autônomo cria org, usuário admin, trial e configuração padrão | 1 | ✅ | `tests/e2e/01-signup-onboarding.spec.ts`, `provisionOrganization` |
| AC02 | Selecionar plano e aplicar limites no servidor | Convite/empresa/anexo acima do limite é recusado pelo servidor | 1 | ✅ | `tests/integration/tenant-isolation.test.ts` (limites), `foundation.test.ts` (downgrade bloqueado) |
| AC03 | Criar e configurar empresas | Onboarding com CNPJ validado, filiais, unidades, centros de custo, contas | 1 | ✅ | Onboarding E2E; CNPJ validado; filial com mesma raiz |
| AC04 | Cadastrar cliente e oportunidade | CRUD + funil | 2 | ✅ | `commercial.test.ts`; E2E `03-commercial.spec.ts` |
| AC05 | Criar e aprovar proposta | Versões, cálculo, alçada, SoD | 2 | ✅ | Alçada por desconto + SoD em `commercial.test.ts`; E2E cria e submete proposta |
| AC06 | Gerar pedido, contrato e projeto | A partir da proposta aceita, com rastreabilidade | 2/3 | ✅ | `commercial.test.ts` (pedido/contrato) e `operations.test.ts` (projeto a partir do contrato com linha de base) |
| AC07 | Planejar recursos e identificar conflitos | Sobrealocação detectada em horas; exceção exige permissão e justificativa | 3 | ✅ | `operations.test.ts` (conflito, exceção autorizada com justificativa) e `tests/unit/operations.test.ts` |
| AC08 | Apontar e aprovar horas | Fluxo rascunho→enviado→aprovado→(cliente)→elegível | 3 | ✅ | `operations.test.ts` (fluxo completo, SoD, cliente, ajuste); E2E `04-operations.spec.ts` |
| AC09 | Registrar despesa reembolsável | Separa devido ao profissional e cobrável do cliente | 3 | ✅ | `operations.test.ts` (custo × devido ao profissional × cobrável; conta a pagar de reembolso) |
| AC10 | Executar compra de serviço até pagamento | Requisição→cotação→PC→aceite→NF fornecedor→CP→pagamento | 4/6 | ✅ | `procurement.test.ts` (até a CP) + `billing-finance.test.ts` (aprovação de CP com SoD e liquidação); seed paga as NFs de fornecedores e aplica o adiantamento do pedido |
| AC11 | Apropriar compras e despesas no projeto | P&L do projeto inclui terceiros e despesas sem duplicar | 4/7 | ✅ | `procurement.test.ts` (analytics) e `controlling.test.ts` (razão: horas + absorção, NF de terceiros com estorno ao cancelar, P&L do projeto) |
| AC12 | Gerar medição com origem rastreável | Cada item aponta origem (tipo + id) | 6 | ✅ | `billing-finance.test.ts`; tela da medição com link para a origem |
| AC13 | Faturar parcialmente sem duplicar itens | Itens já faturados/medidos não reaparecem; unicidade no banco | 6 | ✅ | `billing-finance.test.ts` (parcial, repetição idempotente, item já faturado recusado, cancelamento devolve itens) |
| AC14 | Criar títulos financeiros | Parcelas conforme condição de pagamento, soma exata | 6 | ✅ | `billing.test.ts` (soma exata) e `billing-finance.test.ts` (30/60) |
| AC15 | Receber parcialmente e atualizar saldo | Saldo e status PARTIAL/PAID | 6 | ✅ | `billing-finance.test.ts`; E2E `07-billing-finance.spec.ts` |
| AC16 | Conciliar movimento bancário | Linha de extrato ↔ movimento do livro, sem dupla contagem | 6 | ✅ | `billing-finance.test.ts` (reimportação sem duplicar, conciliação 1:1, tarifa); 🔌 integração bancária automática pendente |
| AC17 | Abrir chamado AMS e medir SLA | Prazos em horário comercial, pausa, violação | 5 | ✅ | `tests/unit/ams.test.ts` (minutos úteis, fuso, feriado, fim de semana) e `tests/integration/ams.test.ts` (pausa, violação, escalonamento, reabertura pelo cliente); E2E `06-ams.spec.ts` |
| AC18 | Consumir franquia e calcular excedente | Razão FIFO de horas, excedente valorizado | 5 | ✅ | `ams.test.ts` (FIFO por vencimento, excedente com decisão, expiração, idempotência, concorrência, consumo na aprovação de horas); cobrança do excedente na Etapa 6 |
| AC19 | Visões 360° de cliente e fornecedor | Páginas consolidadas com navegação até origem | 2/4 | ✅ | Cliente (Etapa 2) e fornecedor (cadastro, conformidade, profissionais, pedidos, cotações, projetos, aceites, documentos, títulos, adiantamentos, pendências, avaliações); E2E `05-procurement.spec.ts` |
| AC20 | Comparar P&L original, revisado, realizado e previsto | Linha de base v1 x vigente x realizado x EAC | 7 | ✅ | `controlling.test.ts` (`projectPl`); tela `/app/controladoria/pl/[id]`; E2E `08-controlling.spec.ts` |
| AC21 | Validar rateios sem duplicar custos | Soma após rateio = soma antes | 7 | ✅ | `controlling.test.ts` (percentual e horas, resto exato, execução única, estorno, versão) |
| AC22 | Fechar período e impedir alterações indevidas | Operações na competência fechada são recusadas | 7 | ✅ | `controlling.test.ts` (razão e títulos recusados no período fechado) |
| AC23 | Reabrir período com autorização e auditoria | Exige permissão + justificativa; auditado | 7 | ✅ | `controlling.test.ts` (sem permissão/justificativa recusa; auditoria registrada) |
| AC24 | Restringir portal ao cliente autorizado | Cliente vê só seus dados, sem custos/comentários internos | 8 | ✅ | `tests/integration/portal.test.ts`; E2E `09-portal.spec.ts` (aprovação de horas, chamado sem notas internas, telas internas redirecionam) |
| AC25 | Impedir acesso entre organizações | Cliente Prisma escopado | 1 | ✅ | `tenant-isolation.test.ts`; exportação isolada em `foundation.test.ts` |
| AC26 | Respeitar escopos de empresa | Usuário com escopo não lê/grava outra empresa | 1 | ✅ | `tenant-isolation.test.ts` (escopo de empresa leitura/escrita) |
| AC27 | Estornar operação sem perder histórico | Estorno cria registro inverso vinculado | 6 | ✅ | `billing-finance.test.ts` (liquidação e movimento bancário inversos vinculados; comissão revertida) |
| AC28 | Preservar documentos ao alterar tarifas e configurações | Snapshots/vigência | 2/3 | ✅ | Snapshot de tarifas do contrato e proposta aprovada imutável (`commercial.test.ts`); custo/hora com vigência (`foundation.test.ts`) |
| AC29 | Impedir duplicidades em operações concorrentes | Medição/cobrança/liquidação simultâneas | 6 | ✅ | Medições simultâneas (`billing-finance.test.ts`), chaves de idempotência de emissão e liquidação, bloqueio de títulos (`FOR UPDATE`), apuração AMS concorrente (`ams.test.ts`) |
| AC30 | Executar CI no GitHub | Workflow verde | 1 | ✅ | Workflow `verify` verde nos PRs (lint, tipos, testes, migrações, seed, build, E2E) |
| AC31 | Demonstrar ciclo completo com dados fictícios | Seed gera dados por meio dos serviços (não números fixos) | 8 | ✅ | `prisma/seed-*.ts`: CRM → proposta → contrato → projeto/AMS → recursos → horas → medição → cobrança → recebimento → razão/DRE; compras → aceite → NF → pagamento → apropriação; 2 empresas + organização isolada |

## Requisitos por módulo

As linhas abaixo são atualizadas a cada etapa (ver também `PROGRESSO.md`).

| Módulo | Requisito | Situação | Observações |
|--------|-----------|----------|-------------|
| SaaS | Organizações, planos, trial, limites, upgrade/downgrade, cancelamento/reativação, retenção, métricas | ✅ | `foundation.test.ts`; painel `/plataforma` |
| SaaS | Provedor de pagamento de assinatura com webhook autenticado e idempotente | 🔌 | Interface + simulação + webhook HMAC idempotente testado; provedor real pendente |
| Segurança | Senha argon2id, bloqueio, recuperação, convites com expiração, MFA TOTP, rate limit | ✅ | `foundation.test.ts`, `dates-docs.test.ts` (TOTP RFC 6238) |
| Segurança | Acesso de suporte autorizado, temporário e auditado | ✅ | `foundation.test.ts` |
| Config | Configurador central (serviços, funil, perdas, tipos de projeto, papéis, competências, senioridade, preços com vigência, calendários/feriados, categorias, plano de contas, CC, condições/métodos de pagamento, alçadas, SLA, modelos, campos adicionais, módulos, fechamento, fiscal) | ✅ | Telas em `/app/config`; validação e auditoria testadas |
| Cadastros | Clientes/prospects, contatos, fornecedores, parceiros, profissionais, serviços, competências, empresas/filiais, CC, contas, categorias, condições | ✅ | Duplicidade, papéis múltiplos, inativação, exclusão só sem uso |
| Cadastros | Importação por planilha com prévia de erros | ✅ | CSV/XLSX, mesmas validações do cadastro manual |
| CRM | Leads, oportunidades, kanban, atividades, indicadores | ✅ | Multi-serviço; conversão de lead; fórmulas em FORMULAS.md |
| Propostas | Versionamento, cálculo, alçadas, PDF, aceite | ✅ | PDF interno; aceite registrado com comprovação (🔌 assinatura certificada externa) |
| Contratos | Pedido, contrato, tarifas, OC, aditivos, mudança de escopo, alertas, comissões | ✅ | Comissão por faturamento/recebimento é acionada na Etapa 6 |
| Projetos | WBS, linha de base, riscos, status, ETC/EAC, portfólio, Gantt | ✅ | EVM só com dados objetivos; encerramentos separados |
| Recursos | Alocações, conflitos, capacidade | ✅ | Grade semanal/mensal em horas; solicitações e sugestões |
| Horas | Fluxo, aprovações, ajustes | ✅ | Aprovação do cliente no portal na Etapa 8 (registro interno já disponível) |
| Despesas | Despesas, adiantamentos, reembolso | ✅ | Devolução de saldo de adiantamento registrada (sem título a receber do profissional) |
| Suprimentos | Ciclo completo, 3 vias, ativos, avaliação | ✅ | Requisição, cotações e mapa comparativo, verificação de orçamento, pedidos (avulsa, subcontratação, PJ, recorrente, licença), aceites/devoluções, conferência de 3 vias, divergência com SoD, ativos e renovações, conformidade e avaliação de fornecedores |
| AMS | Chamados, SLA, franquias | ✅ | Chamados (incidente, requisição, problema, mudança), matriz de prioridade, SLA em horário comercial com pausas, escalonamento, reabertura, satisfação, base de conhecimento com sugestões, banco de horas (franquia, acúmulo, pré-pago, expiração, excedente), apuração diária pelo worker. Portal do cliente na Etapa 8 (serviço já restringe cliente aos próprios chamados e comentários públicos) |
| Faturamento | Motor de medição, cobrança, parcial, retenções | ✅ | Pendências, medições (aprovação interna e do cliente), documento de cobrança (PDF interno, não fiscal), OC do cliente, retenções configuráveis |
| Fiscal | Adaptador NFS-e + simulado | 🔌 | Adaptador, idempotência, tentativas e webhook HMAC implementados; provedor simulado em dev/teste. Provedor real, códigos de serviço e regras de retenção dependem da empresa e do responsável fiscal |
| Financeiro | CR/CP, liquidações, estornos, adiantamentos, compensações, aging | ✅ | Inclui contas recorrentes e comissões por faturamento/recebimento |
| Tesouraria | Contas, transferências, extratos, conciliação, fluxo de caixa | ✅ | Importação CSV/OFX; 🔌 integração bancária automática (API/CNAB) pendente |
| Controladoria | Razão, orçamento, rateio, DRE, P&L, fechamento | ✅ | Razão idempotente (job diário), folha, rateios versionados, orçamento/forecast, DRE com filtros e navegação até a origem, P&L de projetos, fechamento/reabertura, exportação contábil CSV, aprovação das regras de reconhecimento. Não substitui a contabilidade oficial |
| Portais | Cliente e consultor | ✅ | Portal do cliente (`/portal`): chamados, aprovações de horas/medições/entregáveis, projetos (status, riscos/decisões visíveis), financeiro (documentos, títulos, PDF), base de conhecimento. Consultor: `/app/minha-area` |
| Dashboards | Por perfil, rastreáveis | ✅ | `/app`: blocos por permissão (resultado, caixa, faturamento, comercial, projetos, AMS, suprimentos, fechamento, minha semana, aprovações), cada indicador com link para a origem |
