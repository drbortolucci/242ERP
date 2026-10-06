#!/usr/bin/env bash
# Recria o banco de DESENVOLVIMENTO local (descartável) e carrega os dados de demonstração.
set -euo pipefail
if [[ "${APP_ENV:-development}" == "production" ]]; then echo "Proibido em produção"; exit 1; fi
if [[ "${DATABASE_URL:-}" != *"_dev"* ]]; then echo "DATABASE_URL deve apontar para um banco *_dev"; exit 1; fi
npx prisma db execute --file scripts/reset-dev.sql --schema prisma/schema.prisma
npx prisma migrate deploy
npx tsx prisma/seed.ts
