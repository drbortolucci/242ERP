# Registro de progresso

Este arquivo permite continuar o trabalho em outra sessão. Atualizado a cada etapa.

## Estado atual
- Etapa em andamento: **Etapa 1 — Fundação SaaS**
- Branch de trabalho: `etapa-1-fundacao`

## Dependências externas e decisões
| Item | Tipo | Situação |
|------|------|----------|
| Provedor de pagamento de assinaturas (ex.: Stripe, Pagar.me, Asaas, Iugu) | Integração externa — escolha comercial + credenciais | Bloqueia cobrança real; simulação implementada |
| Provedor/ prefeitura de NFS-e e validação do responsável fiscal | Integração externa + validação fiscal | Bloqueia emissão real; adaptador simulado |
| Provedor de e-mail transacional (SMTP/SES etc.) | Integração externa | Caixa de saída simulada |
| Assinatura eletrônica certificada | Integração externa | Registro de aceite + comprovação anexada |
| Integração bancária (API/CNAB) | Integração externa | Importação de extrato CSV/OFX |
| Hospedagem, banco gerenciado, backups, armazenamento de anexos | Infraestrutura | Documentado em `IMPLANTACAO.md`; não provisionado |
| Proteção da branch `main` | Permissão do GitHub | A integração desta sessão não possui permissão de administração; configurar manualmente (ver `CONTRIBUTING.md`) |
| Aprovação das regras de reconhecimento de receita | Decisão da empresa usuária | Métodos configuráveis; aprovação registrada em configuração |

Nenhuma dessas dependências bloqueia a implementação do núcleo.

## Histórico
- 2026-10-06 — Repositório criado; arquitetura, premissas, backlog e matriz registrados; início da Etapa 1.
