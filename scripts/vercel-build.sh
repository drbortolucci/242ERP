#!/usr/bin/env bash
# Build no Vercel: gera o cliente Prisma, aplica migrações e compila a aplicação.
# SEED_DEMO=1 (somente homologação) carrega os dados de demonstração na primeira vez (o seed é idempotente
# e se recusa a rodar com APP_ENV=production).
set -euo pipefail
npx prisma generate
npx prisma migrate deploy
if [[ "${SEED_DEMO:-}" == "1" ]]; then
  npm run db:seed
fi
npx next build
