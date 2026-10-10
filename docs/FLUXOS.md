# Fluxos operacionais

Cada etapa abaixo indica a tela, quem executa e o controle aplicado. Os dados de demonstração (`npm run db:seed`) percorrem todos os fluxos.

## 1. Do comercial ao resultado
| # | Etapa | Tela | Perfil | Controles |
|---|-------|------|--------|-----------|
| 1 | Lead → oportunidade | CRM › Leads/Oportunidades | Comercial | Qualificação, multi-serviço, atividades, funil |
| 2 | Proposta | Propostas | Comercial | Versões, preço/custo/margem, alçada por desconto/margem/valor, SoD, PDF, aceite registrado |
| 3 | Pedido e contrato | Pedidos / Contratos | Comercial | Snapshot de itens e tarifas, OC do cliente, marcos, aditivos aprovados |
| 4 | Projeto | Projetos | PMO | Linha de base versionada, WBS por modelo, riscos, status, Gantt |
| 5 | Recursos | Recursos | Gestor de recursos | Alocação convertida em horas, conflitos com exceção justificada |
| 6 | Horas | Horas | Consultor / gestor / cliente | Rascunho → enviado → aprovado → cliente → elegível; snapshots de custo e tarifa |
| 7 | Medição | Faturamento › Pendências / Medições | Financeiro | Origem rastreável, trava única por origem, aprovação interna (SoD) e do cliente |
| 8 | Cobrança | Faturamento › Documentos | Financeiro | Parcial, idempotente, OC, retenções cadastradas, parcelas exatas, NFS-e via provedor |
| 9 | Recebimento | Financeiro › Contas a receber | Financeiro | Parcial, juros/multa/desconto, estorno vinculado, conciliação bancária |
| 10 | Resultado | Controladoria › DRE / P&L | Controladoria | Razão idempotente, absorção de pessoal, rateios, fechamento |

## 2. Da necessidade de compra à apropriação
| # | Etapa | Tela | Controles |
|---|-------|------|-----------|
| 1 | Requisição | Suprimentos › Requisições | Verificação de orçamento (linha de base do projeto) |
| 2 | Cotação | Requisição › Mapa comparativo | Menor preço total, prazo e por item |
| 3 | Pedido/contratação | Suprimentos › Pedidos | Alçada, SoD, adiantamento, vigência |
| 4 | Aceite | Pedido › Recebimentos e aceites | Limite de saldo e tolerância; ativos para licenças/equipamentos |
| 5 | Cobrança do fornecedor | Pedido › Documentos / Documentos de fornecedor | Conferência de 3 vias; divergência exige aceite justificado ou recusa |
| 6 | Pagamento | Financeiro › Contas a pagar | Aprovação financeira (SoD), liquidação, aplicação de adiantamento |
| 7 | Apropriação | Projeto / Controladoria | Terceiros no projeto pela NF aprovada; PJ pelas horas; compromisso aberto no EAC e fluxo de caixa |

## 2.1 Mercadorias: compra, estoque e venda
Pedido de compra com itens de estoque (depósito de entrada) → aprovação → recebimento (entrada ao preço do pedido; atualiza custo médio) → documento do fornecedor (3 vias) → conta a pagar.
Pedido de venda de produtos → confirmação (reserva o disponível) → entrega (baixa ao custo médio, contas a receber pela condição) → recebimento no financeiro. Cancelamento após a entrega devolve o estoque ao mesmo custo e cancela os títulos sem liquidação. A nota fiscal de mercadorias é emitida pelo provedor fiscal homologado — o pedido não é documento fiscal.

## 2.2 Cobrança bancária
Título a receber em aberto → emissão de boleto/PIX pelo provedor (conta de recebimento da empresa do título) → cliente paga → aviso do banco (webhook assinado) → liquidação automática do título (juros se pago a maior; parcial mantém saldo) → extrato importado → conciliação automática do crédito com o movimento gerado pela liquidação.

## 3. Sustentação (AMS)
Chamado (equipe, portal ou API) → prioridade (impacto × urgência) → prazos de SLA em horário comercial → atendimento (pausas aguardando cliente/terceiro) → resolução → confirmação do cliente / encerramento automático → avaliação. Horas no chamado consomem a franquia (FIFO por vencimento); excedente segue a política do contrato e é medido no faturamento.

## 4. Fechamento mensal
1. Aprovar horas, despesas, medições e contas a pagar pendentes; tratar documentos divergentes.
2. Conciliar extratos.
3. Importar a folha consolidada e sincronizar o razão.
4. Executar rateios.
5. Conferir DRE, orçado × realizado e P&L de projetos.
6. Fechar o período (justificativa obrigatória se houver pendências). Reabertura exige permissão e justificativa.

## 5. Estornos e correções
| Situação | Como corrigir |
|----------|---------------|
| Recebimento/pagamento errado | Estornar a liquidação (registro inverso vinculado) e registrar novamente |
| Documento de cobrança errado | Estornar recebimentos/créditos, cancelar o documento (itens voltam à medição) |
| Hora já faturada errada | Ajuste rastreável (apontamento de ajuste aprovado, elegível na próxima medição) |
| NF de fornecedor cancelada | Cancelar o documento; o razão estorna o lançamento na sincronização |
| Rateio incorreto | Estornar a execução, ajustar a regra (nova versão) e executar novamente |
