# Implantação, backup e checklist de produção

## Componentes
| Componente | Execução | Observações |
|------------|----------|-------------|
| Aplicação web | `npm start` (imagem Docker; `CMD` aplica migrações e inicia) | Stateless; pode ter várias réplicas atrás de balanceador com HTTPS |
| Worker | `npm run worker` (mesma imagem, outro comando) | Agenda e executa tarefas: SLA (5 min), apuração do banco de horas, contas recorrentes, alertas de contratos, sincronização do razão, política de inadimplência SaaS, exportações, emissão fiscal. Pode ter réplicas (fila com `FOR UPDATE SKIP LOCKED`) |
| PostgreSQL 16 | Gerenciado recomendado | Backups automáticos + PITR |
| Armazenamento de anexos | Volume persistente (`STORAGE_DIR`) | Incluir no backup |

## Variáveis de ambiente
| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `APP_ENV` | sim | `production`, `staging`, `development`, `test` |
| `APP_URL` | sim | URL pública **HTTPS** em produção |
| `DATABASE_URL` | sim | Conexão PostgreSQL (usuário com privilégios mínimos para a aplicação) |
| `SESSION_SECRET` | sim | ≥ 32 caracteres aleatórios (`openssl rand -hex 32`); valores de exemplo bloqueiam a inicialização em produção |
| `STORAGE_DIR`, `MAX_UPLOAD_MB` | sim | Diretório absoluto de anexos; limite de upload |
| `EMAIL_PROVIDER`, `PAYMENT_PROVIDER`, `FISCAL_PROVIDER` | não | `simulated` por padrão; provedores reais somente em produção (ou staging com `ALLOW_EXTERNAL_IN_STAGING=1`) |
| `PAYMENT_WEBHOOK_SECRET`, `FISCAL_WEBHOOK_SECRET` | para webhooks | Sem segredo, webhooks são recusados |
| `API_RATE_LIMIT_PER_MIN` | não | Limite por chave de API (padrão 600) |

A inicialização (web e worker) executa `assertConfig()` (`src/server/config-check.ts`): em produção, segredo fraco/de exemplo ou URL sem HTTPS impedem a subida; demais problemas são registrados como aviso. `/api/health` informa banco, fila e quantidade de avisos de configuração.

## Implantação
1. Provisionar PostgreSQL e volume de anexos; configurar segredos no cofre do provedor.
2. Construir a imagem: `docker build -t 242erp:<versão> .`
3. Subir o worker e a aplicação (a aplicação aplica `prisma migrate deploy` ao iniciar; em múltiplas réplicas, prefira executar a migração como etapa única do *pipeline*).
4. Verificar `GET /api/health` (200, `db: ok`).
5. Criar o administrador da plataforma por procedimento controlado (não use o seed de demonstração em produção — ele se recusa a rodar com `APP_ENV=production`).

## Homologação online (Vercel + Supabase)
Ambiente para demonstração e testes de aceite, sem dados reais:
- **Banco**: projeto Supabase (PostgreSQL) com usuário e esquema próprios (`erp`), fora do esquema exposto pela API pública do Supabase. Conexão pelo *pooler* em modo sessão: `postgresql://<usuario>.<ref>:<senha>@<pooler>:5432/postgres?schema=erp&connection_limit=1&pool_timeout=20`.
- **Aplicação**: projeto Vercel ligado ao repositório. `vercel.json` usa `scripts/vercel-build.sh` (gera o Prisma, aplica migrações e, com `SEED_DEMO=1`, carrega os dados de demonstração uma única vez) e a região `gru1` (São Paulo).
- **Variáveis** (todas como segredo no Vercel): `DATABASE_URL`, `SESSION_SECRET` (≥ 32 caracteres), `APP_ENV=staging`, `APP_URL` (URL HTTPS do Vercel), `STORAGE_DIR=/tmp/storage`, `DEMO_PASSWORD` (senha forte, exclusiva do ambiente — o seed se recusa a usar a senha local) e `SEED_DEMO=1`.
- **Limitações**: no Vercel não há worker contínuo nem disco persistente — tarefas agendadas (varredura de SLA, apuração diária, recorrências) não rodam sozinhas e anexos enviados se perdem entre execuções. Para produção use a imagem Docker (aplicação + worker) com volume persistente, como descrito acima.

## Backup e restauração
- **Banco**: backup diário completo + PITR (WAL) com retenção mínima de 30 dias; teste de restauração mensal em ambiente isolado.
  ```bash
  pg_dump --format=custom --no-owner "$DATABASE_URL" > erp-$(date +%F).dump
  pg_restore --clean --if-exists --no-owner -d "$RESTORE_DATABASE_URL" erp-AAAA-MM-DD.dump
  ```
- **Anexos**: cópia incremental diária de `STORAGE_DIR` (mesma retenção).
- **Exportação por organização**: Administração › Privacidade e dados gera pacote integral da organização (útil para portabilidade e encerramento).
- **Restauração**: restaurar banco e anexos do mesmo ponto no tempo; executar `prisma migrate deploy`; validar `/api/health` e amostras (títulos, razão, anexos).

## Checklist de produção
- [ ] `APP_ENV=production`, `APP_URL` com HTTPS, certificado válido
- [ ] `SESSION_SECRET` forte e exclusivo; segredos de webhook definidos
- [ ] Banco gerenciado com backup + PITR; restauração testada
- [ ] Volume de anexos persistente e com backup
- [ ] Worker em execução (monitorar `jobs.failed` e `jobs.delayedPending` em `/api/health`)
- [ ] Logs estruturados (JSON) coletados e com alerta para `level=error`
- [ ] Proteção da branch `main` e revisão obrigatória de PR (ver `CONTRIBUTING.md`)
- [ ] Provedores reais (e-mail, pagamento SaaS, NFS-e) homologados antes de habilitar; responsável fiscal validou códigos de serviço e retenções
- [ ] Regras de reconhecimento de receita aprovadas pela empresa usuária
- [ ] MFA exigido para administradores; revisão periódica de perfis e chaves de API
- [ ] Política de retenção de dados e encerramento de contas definida (sem alegar conformidade LGPD integral)
- [ ] Teste de carga das telas de faturamento e razão com o volume esperado

## Observabilidade e segurança
- Logs JSON estruturados (com redação de campos sensíveis); auditoria funcional em `AuditLog` com `correlationId` por requisição.
- Cabeçalhos de segurança configurados em `next.config.ts` (`Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`); política de conteúdo (CSP) estrita fica como melhoria pendente.
- Limites de taxa no login, recuperação de senha e API.
- Suporte da plataforma acessa dados da organização apenas com autorização temporária concedida pela própria organização (somente leitura, auditado).
