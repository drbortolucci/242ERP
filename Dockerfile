# Imagem única para aplicação web e worker (comando diferente no docker-compose).
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
RUN useradd -r -u 1001 erp && mkdir -p /data/storage && chown -R erp /data /app/.next
USER erp
EXPOSE 3000
# Migrações aplicadas na inicialização (idempotente); depois inicia a aplicação
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
