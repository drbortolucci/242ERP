# Contribuição

## Fluxo de trabalho
1. Crie uma branch a partir de `main`: `etapa-N-descricao`, `feat/<modulo>-<descricao>` ou `fix/<descricao>`.
2. Commits pequenos e descritivos no padrão *Conventional Commits* (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`), em português.
3. Abra um Pull Request com: objetivo, mudanças, como validar, riscos e atualização da matriz de requisitos.
4. O CI precisa estar verde (lint, tipos, testes, verificação de migrações, seed, build, E2E).
5. Não faça push forçado em `main` nem reescreva histórico compartilhado.

## Proteção da branch principal (configurar no GitHub)
Settings → Branches → Add rule para `main`:
- Require a pull request before merging (1 aprovação)
- Require status checks to pass: `CI / verify`
- Require branches to be up to date
- Do not allow force pushes / deletions

## Migrações
- Altere `prisma/schema.prisma` e gere a migração com `npx prisma migrate dev --name <descricao>`.
- Nunca edite migrações já aplicadas em `main`.
- O CI aplica todas as migrações em banco limpo e falha se houver divergência entre schema e migrações.

## Regras de código
- Valores monetários: somente `src/lib/money.ts` (decimal). `parseFloat`/`number` para dinheiro é proibido.
- Datas civis (`YYYY-MM-DD`) x instantes (UTC): `src/lib/dates.ts`.
- Acesso a dados empresariais **somente** via `ctx.db` (cliente escopado). O cliente `prisma` raiz é restrito a autenticação, plataforma e infraestrutura.
- Toda operação: validar entrada (zod), verificar permissão (`requirePerm`), escopo e período, executar em transação quando crítica e registrar auditoria.
- Não grave segredos no repositório. Use `.env` (ignorado) e o cofre do ambiente.

## Versionamento e releases
- Versionamento semântico. Cada etapa concluída gera tag `v0.<etapa>.0` e entrada no `CHANGELOG.md`.
- Ambientes: `development` (local), `staging` (homologação), `production`. Promoção sempre a partir de tags.
