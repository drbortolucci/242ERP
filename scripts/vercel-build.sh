#!/usr/bin/env bash
# Build no Vercel: gera o cliente Prisma, aplica migrações e compila a aplicação.
# SEED_DEMO=1 (somente homologação) carrega os dados de demonstração na primeira vez (o seed é idempotente
# e se recusa a rodar com APP_ENV=production).
#
# Conexões: em execução a aplicação usa DATABASE_URL pelo pooler em modo TRANSAÇÃO (porta 6543, pgbouncer=true),
# que suporta muitas instâncias serverless simultâneas. Migrações e seed precisam de conexão de sessão
# (DIRECT_URL: pooler em modo sessão, porta 5432, ou conexão direta). Sem DIRECT_URL, usa DATABASE_URL.
set -euo pipefail
MIGRATION_URL="${DIRECT_URL:-$DATABASE_URL}"
npx prisma generate
DATABASE_URL="$MIGRATION_URL" npx prisma migrate deploy
if [[ "${SEED_DEMO:-}" == "1" ]]; then
  DATABASE_URL="$MIGRATION_URL" npm run db:seed
fi
npx next build
