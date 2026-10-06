# 242ERP — ERP SaaS para consultorias de serviços

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
- [Integrações e limitações](docs/INTEGRACOES.md)
- [Implantação, backup e restauração](docs/IMPLANTACAO.md)
- [Contribuição](CONTRIBUTING.md)

## Aviso
Os demonstrativos são **gerenciais** e não substituem a contabilidade oficial. O módulo fiscal está preparado para integração e homologação; não há alegação de conformidade fiscal sem validação do responsável fiscal e do provedor. Recursos de privacidade não implicam conformidade integral com a LGPD.
