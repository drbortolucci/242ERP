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
| AC10 | Executar compra de serviço até pagamento | Requisição→cotação→PC→aceite→NF fornecedor→CP→pagamento | 4/6 | ⏳ | |
| AC11 | Apropriar compras e despesas no projeto | P&L do projeto inclui terceiros e despesas sem duplicar | 4/7 | ⏳ | |
| AC12 | Gerar medição com origem rastreável | Cada item aponta origem (tipo + id) | 6 | ⏳ | |
| AC13 | Faturar parcialmente sem duplicar itens | Itens já faturados/medidos não reaparecem; unicidade no banco | 6 | ⏳ | |
| AC14 | Criar títulos financeiros | Parcelas conforme condição de pagamento, soma exata | 6 | ⏳ | |
| AC15 | Receber parcialmente e atualizar saldo | Saldo e status PARTIAL/PAID | 6 | ⏳ | |
| AC16 | Conciliar movimento bancário | Linha de extrato ↔ movimento do livro, sem dupla contagem | 6 | ⏳ | |
| AC17 | Abrir chamado AMS e medir SLA | Prazos em horário comercial, pausa, violação | 5 | ⏳ | |
| AC18 | Consumir franquia e calcular excedente | Razão FIFO de horas, excedente valorizado | 5 | ⏳ | |
| AC19 | Visões 360° de cliente e fornecedor | Páginas consolidadas com navegação até origem | 2/4 | 🟡 | Visão 360° do cliente ✅; do fornecedor na Etapa 4 |
| AC20 | Comparar P&L original, revisado, realizado e previsto | Linha de base v1 x vigente x realizado x EAC | 7 | ⏳ | |
| AC21 | Validar rateios sem duplicar custos | Soma após rateio = soma antes | 7 | ⏳ | |
| AC22 | Fechar período e impedir alterações indevidas | Operações na competência fechada são recusadas | 7 | ⏳ | |
| AC23 | Reabrir período com autorização e auditoria | Exige permissão + justificativa; auditado | 7 | ⏳ | |
| AC24 | Restringir portal ao cliente autorizado | Cliente vê só seus dados, sem custos/comentários internos | 8 | ⏳ | |
| AC25 | Impedir acesso entre organizações | Cliente Prisma escopado | 1 | ✅ | `tenant-isolation.test.ts`; exportação isolada em `foundation.test.ts` |
| AC26 | Respeitar escopos de empresa | Usuário com escopo não lê/grava outra empresa | 1 | ✅ | `tenant-isolation.test.ts` (escopo de empresa leitura/escrita) |
| AC27 | Estornar operação sem perder histórico | Estorno cria registro inverso vinculado | 6 | ⏳ | |
| AC28 | Preservar documentos ao alterar tarifas e configurações | Snapshots/vigência | 2/3 | ✅ | Snapshot de tarifas do contrato e proposta aprovada imutável (`commercial.test.ts`); custo/hora com vigência (`foundation.test.ts`) |
| AC29 | Impedir duplicidades em operações concorrentes | Medição/cobrança/liquidação simultâneas | 6 | ⏳ | |
| AC30 | Executar CI no GitHub | Workflow verde | 1 | 🟡 | Workflow `.github/workflows/ci.yml` (aguardando primeira execução no PR) |
| AC31 | Demonstrar ciclo completo com dados fictícios | Seed gera dados por meio dos serviços (não números fixos) | 8 | ⏳ | |

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
| Suprimentos | Ciclo completo, 3 vias, ativos, avaliação | ⏳ | |
| AMS | Chamados, SLA, franquias | ⏳ | |
| Faturamento | Motor de medição, cobrança, parcial, retenções | ⏳ | |
| Fiscal | Adaptador NFS-e + simulado | ⏳ | 🔌 provedor real e validação fiscal |
| Financeiro | CR/CP, liquidações, estornos, adiantamentos, compensações, aging | ⏳ | |
| Tesouraria | Contas, transferências, extratos, conciliação, fluxo de caixa | ⏳ | 🔌 integração bancária automática |
| Controladoria | Razão, orçamento, rateio, DRE, P&L, fechamento | ⏳ | |
| Portais | Cliente e consultor | ⏳ | |
| Dashboards | Por perfil, rastreáveis | ⏳ | |
