# Integrações e limitações

## Princípio
Toda integração externa passa por um **adaptador** com implementação **simulada** identificada. Em `APP_ENV=development` e `test` o provedor é **sempre** o simulado, independentemente da configuração (`src/server/providers/env.ts`) — nenhuma mensagem, cobrança, nota ou transação real é emitida. Credenciais nunca ficam no código nem no banco: a configuração guarda apenas o **nome** do segredo no cofre do ambiente.

| Integração | Adaptador | Situação |
|------------|-----------|----------|
| Cobrança de assinaturas SaaS | `src/server/providers/payments.ts` | 🔌 Simulado + webhook HMAC idempotente (`/api/webhooks/payments/{provider}`); provedor real pendente |
| NF-e (mercadorias) | `src/server/providers/fiscal.ts` (`issueProduct`), `src/modules/fiscal/service.ts` | 🔌 Simulado; emissão só com regra fiscal vigente e validada pelo responsável fiscal para cada item; provedor real homologado pendente |
| NFS-e | `src/server/providers/fiscal.ts`, `src/modules/billing/fiscal.ts` | 🔌 Simulado com idempotência, tentativas e webhook HMAC (`/api/webhooks/fiscal`); provedor real + validação do responsável fiscal pendentes |
| E-mail transacional | `src/server/providers/email.ts` | 🔌 Caixa de saída simulada (`OutboundMessage`) |
| Extrato bancário | `src/domain/statement.ts`, `src/modules/banking/service.ts` | ✅ Importação de arquivo CSV/OFX e conciliação automática (valor/data e regras por descrição); 🔌 API de extrato do banco pendente |
| Cobrança bancária (boleto/PIX) | `src/server/providers/banking.ts`, `src/modules/banking/service.ts` | 🔌 Simulado com idempotência, baixa automática por webhook HMAC (`/api/webhooks/cobranca/{provider}`) e liquidação do título; provedor real (API do banco ou gateway) e homologação com o banco pendentes. Arquivos CNAB (remessa/retorno) dependem do leiaute de cada banco e não estão implementados |
| Folha de pagamento | `importPayroll` | ✅ Importação consolidada por centro de custo (CSV); integração com sistema de folha pendente |
| Contabilidade | `/api/razao` | ✅ Exportação CSV dos lançamentos gerenciais por competência |
| Assinatura eletrônica | — | 🔌 Aceite registrado com evidência anexada; provedor certificado pendente |
| SSO (OIDC/SAML) | — | ⏳ Pendente (autenticação própria com MFA TOTP disponível) |

## API pública (v1)
Autenticação: `Authorization: Bearer erp_<prefixo>_<segredo>` (crie em Administração › Chaves de API). A chave é exibida uma vez e armazenada como hash SHA-256. Limite padrão: 600 requisições/min por chave (`API_RATE_LIMIT_PER_MIN`). Disponível nos planos que incluem o módulo `api`.

| Método e rota | Escopo | Descrição |
|---------------|--------|-----------|
| `GET /api/v1/clientes` | `read:parties` | Clientes e prospects |
| `GET /api/v1/contratos` | `read:contracts` | Contratos |
| `GET /api/v1/projetos` | `read:projects` | Projetos |
| `GET /api/v1/chamados` | `read:tickets` | Chamados com prazos e situação de SLA |
| `POST /api/v1/chamados` | `write:tickets` | Abre chamado (`partyId`, `title`, `description`, `impact` 1–3, `urgency` 1–3, `type`, opcionais `contractId`, `companyId`, `system`, `module`) |
| `GET /api/v1/titulos-receber` | `read:receivables` | Títulos a receber |

Parâmetros de listagem: `page` (≥ 1), `limit` (1–100), `updatedSince` (ISO 8601). Resposta: `{ data, page, limit, total }`. Erros: `{ error: { code, message } }` com 401 (chave), 403 (escopo/plano), 404, 409, 422 (validação/regra), 429 (limite), 500.

```bash
curl -s -H "Authorization: Bearer $ERP_API_KEY" "https://erp.exemplo.com/api/v1/chamados?limit=20"
curl -s -X POST -H "Authorization: Bearer $ERP_API_KEY" -H "Content-Type: application/json" \
  -d '{"partyId":"...","title":"Integração parada","description":"Fila sem consumo","impact":1,"urgency":1,"type":"INCIDENT"}' \
  https://erp.exemplo.com/api/v1/chamados
```
As respostas não incluem custos, margens nem comentários internos. Escritas são auditadas com a chave como ator (`api:<id>`).

## Webhooks recebidos
| Rota | Autenticação | Idempotência |
|------|--------------|--------------|
| `POST /api/webhooks/payments/{provider}` | Cabeçalho `x-signature` = HMAC-SHA256(`PAYMENT_WEBHOOK_SECRET`, corpo) | Por id do evento (`WebhookEvent`) |
| `POST /api/webhooks/fiscal` | Cabeçalho `x-signature` = HMAC-SHA256(`FISCAL_WEBHOOK_SECRET`, corpo) | Por (externalId, situação) |
| `POST /api/webhooks/cobranca/{provider}` | Cabeçalho `x-signature` = HMAC-SHA256(`BANKING_WEBHOOK_SECRET`, corpo); corpo normalizado pelo adaptador (`externalId`, `type` PAID/CANCELED/EXPIRED, `paidAmount`, `paidAt`) | Liquidação com chave `charge:{id}`; aviso repetido registrado como duplicado |

## Limitações conhecidas
- Demonstrativos e P&L são **gerenciais** (não substituem a contabilidade oficial, SPED ou obrigações acessórias).
- Não há alegação de conformidade fiscal: códigos de serviço, retenções e emissão real dependem de provedor homologado e validação do responsável fiscal.
- Recursos de privacidade (exportação integral, acesso de suporte autorizado, retenção) **não** implicam conformidade integral com a LGPD.
- Multimoeda: apenas armazenamento do código da moeda; sem conversão cambial.
- Transferências entre empresas diferentes (mútuos) não são tratadas como transferência.
- Folha importada de forma consolidada; não há cálculo de folha.
- Anexos em disco local (adaptador); produção requer volume persistente com backup ou adaptador de objeto.
- Notificações são internas; envio de e-mail real depende de provedor configurado em produção.
