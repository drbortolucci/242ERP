# Registro de progresso

Este arquivo permite continuar o trabalho em outra sessão. Atualizado a cada etapa.

## Estado atual
- Etapa em andamento: **Etapa 8 — Portais e dashboards**
- PRs #1 e #2 integrados em `main`; Etapas 3 a 7 (PRs #3–#7, empilhados) aguardando integração.

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

## Etapa 1 — Fundação SaaS (concluída)
- Entregue: ver CHANGELOG 0.1.0. Testes: 36 unitários/integração + 3 E2E.
- Restrições: provedor de pagamento simulado; e-mail simulado (caixa de saída); MFA por TOTP (sem SMS); SSO pendente.
- Próximo: Etapa 2 — CRM, propostas, contratos e visão 360° do cliente.

## Etapa 2 — Comercial (concluída)
- Entregue: ver CHANGELOG 0.2.0. Testes de integração do ciclo comercial completo + 2 E2E.
- Restrições: assinatura eletrônica certificada não integrada (aceite registrado + comprovação anexada).

## Etapa 3 — Operação (concluída)
- Projetos (WBS por modelo, dependências sem ciclo, kanban, Gantt, riscos/problemas/decisões, status, linha de base versionada, ETC/EAC, EVM condicional, encerramentos operacional e financeiro), portfólio, recursos (capacidade em horas, conflitos, exceções autorizadas), horas e despesas/adiantamentos.
- Pendência: tags de release não puderam ser enviadas (o proxy desta sessão recusa push de tags) — versões registradas no CHANGELOG.

## Etapa 4 — Suprimentos (concluída)
- Entregue: ver CHANGELOG 0.4.0. Testes: 60 unitários/integração + 9 E2E.
- Restrições: pagamento das contas a pagar e aplicação de adiantamento a fornecedor ficam no Financeiro (Etapa 6); orçamento por centro de custo/conta depende do módulo de orçamento (Etapa 7) — até lá a verificação usa a linha de base do projeto.
- Decisão: PMO recebe a permissão `purchase.receive` (o gestor do projeto aceita serviços entregues).

## Etapa 5 — AMS (concluída)
- Entregue: ver CHANGELOG 0.5.0. Testes: 73 unitários/integração + 10 E2E.
- Restrições: notificações apenas internas (sem e-mail real em desenvolvimento); cobrança de mensalidade e excedente na Etapa 6; abertura de chamados pelo cliente via portal na Etapa 8 (regras de acesso já no serviço).

## Etapa 6 — Monetização e financeiro (concluída)
- Entregue: ver CHANGELOG 0.6.0. Testes: 82 unitários/integração + 11 E2E.
- Restrições: NFS-e somente simulada (🔌 provedor real + validação do responsável fiscal); nenhuma regra de retenção ou código de serviço é pré-cadastrado; integração bancária automática pendente (importação de extrato por arquivo); transferências entre empresas diferentes não suportadas (exigem mútuo).

## Etapa 7 — Controladoria (concluída)
- Entregue: ver CHANGELOG 0.7.0. Testes: 85 unitários/integração + 12 E2E.
- Restrições: visão gerencial (não substitui contabilidade oficial nem SPED); folha importada de forma consolidada (sem integração com sistema de folha); alíquota de dedução gerencial informada no contrato pela empresa.

## Como continuar
1. `npm ci && cp .env.example .env` (ajuste DATABASE_URL e SESSION_SECRET).
2. `npm run db:reset` (recria banco *_dev local e carrega a demonstração).
3. `npm run dev` e entre com `admin@demo.local` / senha exibida no seed.
4. `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:e2e`.

## Histórico
- 2026-10-06 — Repositório criado; arquitetura, premissas, backlog e matriz registrados; início da Etapa 1.
- 2026-10-06 — Etapa 1 concluída (fundação SaaS) — PR `etapa-1-fundacao`.
- 2026-10-07 — Etapa 4 concluída (suprimentos) — PR `etapa-4-suprimentos`.
- 2026-10-07 — Etapa 5 concluída (AMS) — PR `etapa-5-ams`.
- 2026-10-07 — Etapa 6 concluída (faturamento e financeiro) — PR `etapa-6-financeiro`.
- 2026-10-07 — Etapa 7 concluída (controladoria) — PR `etapa-7-controladoria`.
