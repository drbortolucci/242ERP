# Arquitetura — 242ERP

## 1. Premissas adotadas

| # | Premissa | Impacto |
|---|----------|---------|
| P1 | Repositório novo (`drbortolucci/242erp`), sem código prévio. Stack definida por este projeto. | Next.js + Prisma + PostgreSQL |
| P2 | Moeda funcional BRL; multi-moeda apenas armazenada (campo `currency`), sem conversão cambial. | Conversão cambial pendente |
| P3 | Fuso padrão `America/Sao_Paulo`, configurável por organização e empresa. Instantes em UTC. | Datas civis em colunas `DATE` |
| P4 | Regras fiscais (alíquotas, códigos de serviço, retenções) **não** são definidas pelo sistema: são cadastradas e validadas pelo responsável fiscal, com vigência. | Nenhuma alíquota "embutida" |
| P5 | Reconhecimento de receita gerencial por método configurado no contrato (T&M, % de conclusão por horas, marcos, linear, na medição). Exige aprovação documental do responsável da empresa (registrada em configuração). | P&L gerencial ≠ contabilidade oficial |
| P6 | Custo de profissionais internos nos projetos = horas aprovadas × custo/hora vigente na data (snapshot). A folha real entra por importação; a parcela absorvida pelos projetos é creditada em conta redutora para não duplicar. | Ver `docs/FORMULAS.md` |
| P7 | Provedores externos (pagamento SaaS, NFS-e, e-mail, assinatura eletrônica, bancos) começam **simulados** e claramente identificados; em `development`/`test` nenhuma ação externa real ocorre. | Integrações reais pendentes de credenciais |
| P8 | Anexos em disco local (adaptador). Produção deve usar volume persistente ou adaptador S3 compatível. | Ver checklist de produção |
| P9 | Autenticação própria (senha argon2id, sessão em cookie httpOnly, TOTP opcional). SSO corporativo (OIDC/SAML) é posterior. | |
| P10 | "Mini ERP": telas objetivas, mas com controles completos (aprovação, auditoria, fechamento, estorno). | |

## 2. Visão geral

Monólito modular em **Next.js 15 (App Router) + TypeScript**, **PostgreSQL 16** via **Prisma 6**.

```
Navegador ──► Next.js (React Server Components + Server Actions + Route Handlers)
                 │
                 ├─ src/app/            Interface (rotas, páginas, formulários)
                 ├─ src/modules/<m>/    Aplicação: serviços (casos de uso), validação zod, regras
                 ├─ src/domain/         Domínio puro (cálculos de preço, SLA, P&L, faturamento) — sem I/O
                 ├─ src/server/         Infraestrutura: db, isolamento, contexto, auditoria, jobs, provedores
                 └─ src/lib/            Utilitários compartilhados (dinheiro, datas, documentos, permissões)
                 │
                 ▼
            PostgreSQL ◄── Worker (tarefas em segundo plano: SLA, recorrências, exportações, webhooks)
```

### Camadas
- **Interface** (`src/app`): páginas server-side; formulários enviam *Server Actions* que apenas validam a entrada e chamam serviços.
- **Aplicação** (`src/modules/*/service.ts`): casos de uso. Recebem `Ctx` (usuário, organização, permissões, escopo) e executam regras com transações.
- **Domínio** (`src/domain`): funções puras e determinísticas, cobertas por testes unitários (precificação, SLA em horário comercial, motor de faturamento, P&L, aging, rateio).
- **Persistência**: Prisma + migrações versionadas (`prisma/migrations`).

## 3. Multi-tenant e isolamento

- **Plataforma** → **Organização (tenant)** → **Empresa** (pessoa jurídica, matriz/filial) → **Unidade de negócio** / **Centro de custo**.
- Todas as tabelas empresariais têm `organizationId`.
- **Isolamento por construção**: `createTenantDb()` (`src/server/tenant-db.ts`) é um cliente Prisma estendido que injeta `organizationId` em todas as leituras, atualizações, exclusões e criações e rejeita gravações em outra organização. O mesmo cliente aplica o **escopo de empresas** do usuário a todo modelo com `companyId`.
- Não há relações Prisma entre modelos empresariais — portanto não existe `include` capaz de atravessar o filtro. Dados relacionados são carregados por consultas também escopadas (`hydrate`).
- O cliente "raiz" (`prisma`) é usado apenas em autenticação, painel da plataforma e montagem de contexto.
- Tarefas em segundo plano montam o mesmo `Ctx` (via `buildCtx`) a partir do usuário solicitante.
- **Administrador da plataforma** não possui membership nas organizações. Acesso de suporte exige concessão (`SupportAccessGrant`) feita por um administrador da organização, com prazo, e gera sessão **somente leitura** sem custos/margens, auditada.

## 4. Autorização

- Permissões por **ação + módulo** (`src/lib/permissions.ts`), agrupadas em perfis editáveis por organização (14 perfis padrão).
- **Escopo de dados**: empresas permitidas (membership), cliente autorizado (portal), profissional vinculado (portal do consultor).
- **Sigilo**: `cost.view` e `margin.view` controlam custos, remuneração e margens — os serviços removem esses campos das respostas quando ausentes.
- **Alçadas** (`ApprovalRule`): por tipo de documento, empresa, valor, desconto e margem; geram `ApprovalRequest` com nível e permissão exigida.
- **Segregação de funções** (configurável em `sod`): solicitante não aprova; aprovador de conta a pagar não paga; etc.
- Toda verificação ocorre no servidor (`requirePerm`, `requireWritable`, `requireModule`); a interface apenas oculta o que não é permitido.

## 5. Dinheiro, datas e concorrência

- Valores: `Decimal(18,2)`; tarifas/custos unitários `Decimal(18,4)`; horas `Decimal(12,2)`. Biblioteca `decimal.js` (`src/lib/money.ts`), arredondamento HALF_UP em 2 casas no valor persistido; rateios distribuem a diferença de centavos na última parcela. `parseFloat` é proibido pelo lint.
- Datas civis (`DATE`) x instantes (`timestamptz` UTC) — `src/lib/dates.ts`.
- Operações críticas em transação. Duplicidade impedida por **unicidade no banco**:
  - `BillingLock (organizationId, sourceType, sourceKey)` — cada origem (apontamento, mensalidade do mês, marco, despesa) só entra em uma medição ativa.
  - `BillingDocument.idempotencyKey`, `Settlement.idempotencyKey`, `FiscalDocument.idempotencyKey`, `WebhookEvent(provider,eventId)`, `ManagerialEntry.dedupeKey`, `Payable(sourceType,sourceId)`.
  - Numeração de documentos atômica (`INSERT ... ON CONFLICT ... RETURNING`).
- Lançamentos efetivados não são apagados: estorno gera registro inverso vinculado (`reversalOfId`).
- Períodos fechados (`AccountingPeriod`) bloqueiam apontamentos, despesas, liquidações, faturamento e lançamentos gerenciais naquela competência.

## 6. Integrações externas (adaptadores)

| Integração | Interface | Implementação atual |
|-----------|-----------|---------------------|
| E-mail | `EmailProvider` | Simulado → caixa de saída `OutboundMessage` |
| Assinatura SaaS (pagamentos) | `PaymentProvider` + webhook HMAC | Simulado |
| NFS-e | `FiscalProvider` + webhook HMAC | Simulado (marcado "SIMULAÇÃO — sem validade fiscal") |
| Assinatura eletrônica | `ESignProvider` | Registro de aceite + anexo de comprovação |
| Bancos | Importação de extrato CSV/OFX | Importação manual |
| Contabilidade | Exportação CSV do razão gerencial | Arquivo |
| API externa | Chaves de API com escopo (hash) | Endpoints de leitura |

Em `APP_ENV=development|test` todos os provedores são forçados ao modo simulado (`src/server/providers/env.ts`).

## 7. Tarefas em segundo plano

Tabela `Job` com `FOR UPDATE SKIP LOCKED` (`src/server/jobs`). Worker: `npm run worker`. Tarefas: verificação de SLA/escalação, geração de contas a pagar recorrentes, expiração de banco de horas, exportação de dados do cliente, política de suspensão por inadimplência, reprocessamento fiscal. Tarefas idempotentes por `uniqueKey`.

## 8. Ambientes

`APP_ENV`: `development` (local, dados fictícios), `staging` (homologação, provedores em sandbox somente com `ALLOW_EXTERNAL_IN_STAGING=1`), `production`. Cada ambiente com banco, segredos e armazenamento próprios. Ver `docs/IMPLANTACAO.md`.
