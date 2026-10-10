# 242ERP — ERP SaaS para empresas de serviços

ERP para **qualquer empresa de serviços**, com especialidade em **consultorias** (TI/ERP e gestão). No cadastro a organização escolhe o setor de atividade — consultoria e TI, consultoria de gestão, engenharia e arquitetura, agências, escritórios contábeis/jurídicos, manutenção e serviços em campo, software, educação ou serviços em geral — que define tipos de projeto e modelos de WBS, serviços, papéis, categorias de despesa e a terminologia exibida (ex.: *Jobs*, *Ordens de serviço*, *Trabalhos*). Tudo é editável e as regras de negócio são as mesmas para todos os setores ([setores](docs/GUIA_CONFIGURACAO.md#0-setor-de-atividade-e-terminologia)).

ERP multiempresa e multi-tenant que conecta **CRM → proposta → pedido → contrato → projeto/AMS → recursos → horas → medição → faturamento → recebimento → resultado**, e **requisição → cotação → compra → aceite → cobrança do fornecedor → pagamento → apropriação no projeto e na controladoria**.

> Situação de cada requisito: [docs/MATRIZ_REQUISITOS.md](docs/MATRIZ_REQUISITOS.md) · Progresso: [docs/PROGRESSO.md](docs/PROGRESSO.md)

## Stack
TypeScript · Next.js 15 (App Router, Server Actions) · React 19 · PostgreSQL 16 · Prisma 6 · Tailwind CSS · zod · react-hook-form · Vitest · Playwright.

## Execução local

Pré-requisitos: Node.js 20.11+ e PostgreSQL 16 (ou Docker).

```bash
cp .env.example .env            # ajuste DATABASE_URL e SESSION_SECRET
docker compose up -d db         # opcional: PostgreSQL local em container
npm ci
npm run db:deploy               # aplica migrações
npm run db:seed                 # dados de demonstração (2 organizações fictícias)
npm run dev                     # http://localhost:3000
npm run worker                  # tarefas em segundo plano (outro terminal)
```

Credenciais de demonstração são exibidas ao final do `db:seed` e valem **somente** para o ambiente local.

## Usuários de demonstração
Senha exibida ao final do seed (somente local). Perfis: `admin@`, `diretor@`, `comercial@`, `pmo@`, `recursos@`, `financeiro@`, `controladoria@`, `compras@`, `ams@`, `estoque@`, `consultor@demo.local`; portal do cliente: `cliente@alfa.local`, `cliente@gama.local`, `cliente@beta.local`; organização isolada: `admin@outra.local`; plataforma: `plataforma@242erp.local`.

## Módulos
CRM · propostas · contratos e comissões · projetos e portfólio · recursos · horas · despesas · suprimentos (3 vias) · estoque (custo médio, inventário, reposição) e vendas de produtos · AMS (SLA, banco de horas) · medição e faturamento · NFS-e (adaptador) · contas a receber/pagar · tesouraria, cobrança bancária (boleto/PIX, adaptador) e conciliação automática · controladoria (razão, rateios, orçamento, DRE, P&L, fechamento) · portal do cliente · painéis por perfil · API pública · administração SaaS.

## Verificações
```bash
npm run lint
npm run typecheck
npm test                 # unitários + integração (usa TEST_DATABASE_URL, banco descartável *_test)
npm run test:e2e         # Playwright
npm run build
```

## Documentação
- [Arquitetura e premissas](docs/ARQUITETURA.md)
- [Modelo de dados](docs/MODELO_DADOS.md)
- [Backlog](docs/BACKLOG.md) · [Matriz de requisitos](docs/MATRIZ_REQUISITOS.md) · [Progresso](docs/PROGRESSO.md)
- [Fórmulas dos indicadores](docs/FORMULAS.md)
- [Guia de configuração](docs/GUIA_CONFIGURACAO.md) · [Fluxos operacionais](docs/FLUXOS.md)
- [Integrações, API pública e limitações](docs/INTEGRACOES.md)
- [Implantação, backup e restauração](docs/IMPLANTACAO.md)
- [Contribuição](CONTRIBUTING.md)

## Aviso
Os demonstrativos são **gerenciais** e não substituem a contabilidade oficial. O módulo fiscal está preparado para integração e homologação; não há alegação de conformidade fiscal sem validação do responsável fiscal e do provedor. Recursos de privacidade não implicam conformidade integral com a LGPD.
