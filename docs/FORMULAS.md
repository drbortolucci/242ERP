# Fórmulas, regras de cálculo e fontes dos indicadores

Convenções gerais: valores em `Decimal` (sem ponto flutuante); arredondamento **HALF_UP em 2 casas** no valor persistido; rateios e parcelas distribuem a diferença de centavos na última parte (soma sempre exata). Datas de competência e vencimento são **datas civis**; instantes em UTC exibidos no fuso da organização.

## 1. Precificação de propostas (`src/domain/pricing.ts`)
| Indicador | Fórmula |
|-----------|---------|
| Receita da linha | horas × tarifa (perfis) ou quantidade × preço unitário (demais tipos); linhas não faturáveis = 0 |
| Custo da linha | horas × custo/hora ou quantidade × custo unitário |
| Receita bruta | Σ receita das linhas |
| Desconto | Receita bruta × desconto% |
| Receita líquida | Receita bruta − Desconto |
| Tributos estimados | Receita líquida × tributos% (parâmetro gerencial informado; **não é regra fiscal**) |
| Custo total | Pessoal + terceiros/licenças/itens fechados + despesas |
| **Margem de contribuição (MC)** | Receita líquida − Tributos estimados − Custo total |
| Margem % | MC ÷ Receita líquida × 100 (indefinida se receita = 0) |
| **Markup %** | (Receita líquida − Custo total) ÷ Custo total × 100 |

Margem e markup usam bases diferentes (receita × custo) e **não** devem ser comparados entre si. MC não é lucro líquido.

Alçadas (`ApprovalRule`): exige aprovação se desconto **>** limite, margem **<** limite ou valor **≥** limite. Limite exato de desconto não dispara.

## 2. CRM (`crmMetrics`)
| Indicador | Fórmula | Fonte |
|-----------|---------|-------|
| Pipeline bruto | Σ valor estimado das oportunidades abertas | `Opportunity` status OPEN |
| Pipeline ponderado | Σ valor × probabilidade% | idem |
| Conversão | ganhas ÷ (ganhas + perdidas) no período | `wonAt`/`lostAt` |
| Tempo médio de venda | média(data de ganho − data de criação) em dias | idem |
| Sem atividade | abertas sem interação há mais de 14 dias | `lastActivityAt` |
| Previsão de fechamento | Σ ponderado agrupado pelo mês da data prevista | `expectedCloseDate` |
| Vendas por responsável/cliente/serviço | Σ valor das ganhas (serviço: Σ itens) | `OpportunityItem` |

## 3. Saldos de contrato (`contractBalances`)
| Saldo | Fórmula |
|-------|---------|
| Contratado | valor vigente (inclui aditivos aprovados) |
| Executado | Σ (horas aprovadas faturáveis × tarifa snapshot) + marcos aceitos + despesas cobráveis aprovadas + mensalidades/excedentes/ajustes medidos |
| Faturado | Σ valor bruto dos documentos de cobrança emitidos (não cancelados) |
| Recebido | Σ principal liquidado dos títulos do contrato (líquido de estornos) |
| Saldo disponível | Contratado − Executado |
| Executado não faturado | máx(0, Executado − Faturado) |

Alertas: vigência a vencer (dentro do aviso de renovação), saldo disponível abaixo do % configurado, execução acima do contratado (aplica a política de excedente), horas acima do limite, falta de OC vigente quando exigida.

Tarifa aplicável a um apontamento: tarifa vigente na data, mais específica (profissional > papel+senioridade > papel > senioridade > genérica). Snapshot gravado no apontamento.

## 4. Comissões
Base por regra: contratação (valor do contrato na ativação), faturamento (valor do documento emitido) ou recebimento (principal liquidado). Valor = base × %. Cancelamento/estorno/baixa por inadimplência geram lançamento de reversão (nunca exclusão). Regra com parceiro só se aplica quando a oportunidade tem esse parceiro.

## 5. Capacidade e alocação (`src/domain/capacity.ts`)
- Capacidade(dia) = horas do calendário do profissional no dia da semana × capacidade% ; zero em feriados e ausências.
- Alocação em %: horas(dia) = capacidade(dia) × %. Em horas/dia: valor em cada dia útil do calendário. Em total de horas: distribuído proporcionalmente à capacidade.
- **Percentuais nunca são somados entre calendários diferentes**: tudo é convertido em horas antes de comparar.
- Sobrealocação: Σ horas alocadas no dia > capacidade × (1 + tolerância%). Confirmar com conflito exige `resource.override` + justificativa (auditada).
- Grade: capacidade, alocado (confirmado + provisório), apontado, faturável. **Utilização faturável** = horas faturáveis apontadas ÷ capacidade.

## 6. Projetos (`src/domain/project-metrics.ts`, `src/modules/projects/analytics.ts`)
| Indicador | Fórmula |
|-----------|---------|
| Avanço — horas | horas aprovadas ÷ esforço da linha de base vigente (máx. 100%) |
| Avanço — marcos | Σ valor dos marcos aceitos ÷ Σ valor dos marcos |
| Avanço — peso | Σ peso das atividades concluídas ÷ Σ pesos |
| Avanço — manual | informado; **não habilita EVM** |
| Custo realizado (AC) | Σ custo snapshot das horas aprovadas + NF de fornecedores aprovadas do projeto (exceto pedidos de profissional PJ) + despesas aprovadas |
| Comprometido não realizado | Σ máx(0, valor do pedido aprovado − NF aprovadas desse pedido), excluindo pedidos encerrados e pedidos de profissional PJ |
| BAC | custo total da linha de base vigente |
| PV | Σ custo planejado mensal da linha de base até o mês corrente |
| EV | BAC × avanço% |
| SPI / CPI | EV ÷ PV / EV ÷ AC — exibidos **somente** com linha de base distribuída, PV > 0 e critério objetivo |
| ETC | estimativa registrada (pessoal + terceiros **ainda não contratados** + despesas); sem estimativa: horas restantes × custo médio realizado |
| EAC custo | AC + comprometido não realizado + ETC (compromissos entram uma única vez) |
| Receita prevista | receita reconhecida (razão gerencial) + receita remanescente estimada |
| Margem prevista | receita prevista − EAC custo |

Sinais do portfólio: atraso (término planejado vencido ou atividades vencidas), estouro (EAC > BAC), margem prevista < 15%, entregáveis concluídos sem aceite, execução não faturada.

## 7. Horas
- Faturamento por hora somente nos modelos T&M, pacote de horas, advisory, treinamento e híbrido; em preço fechado, alocação mensal e AMS as horas são custo/consumo (cobrança via marcos, mensalidade e excedente de franquia).
- Snapshot na aprovação: custo/hora vigente (`costRate`, `costAmount = horas × custo`) e tarifa contratual vigente (`sellRate`).
- Hora extra: total do dia > limite configurado. Limite diário, frações de 15 minutos e períodos fechados validados no servidor.
- Profissionais PJ/parceiros: custo do projeto reconhecido pelas horas aprovadas × custo/hora contratado; a nota do PJ liquida a obrigação (não gera custo em duplicidade).

## 8. Suprimentos (`src/domain/three-way-match.ts`, `src/modules/procurement/service.ts`)
| Regra | Fórmula / comportamento |
|-------|-------------------------|
| Estimativa da requisição | Σ quantidade × preço unitário estimado |
| Verificação de orçamento | referência = projeto (custo de terceiros da linha de base vigente) ou centro de custo/conta (orçamento — Etapa 7); disponível = orçado − Σ pedidos aprovados/em aprovação da mesma referência; **alerta**, não bloqueio (a alçada decide) |
| Mapa comparativo | menor total, menor prazo e menor preço unitário por item (`compareQuotations`) |
| Total do pedido | Σ arredondar(quantidade × preço unitário, 2) por linha |
| Recebimento/aceite | valor = quantidade × preço unitário; não pode exceder saldo do item × (1 + tolerância%); devolução limitada ao recebido não faturado |
| Faturável pelo fornecedor | recebido/aceito − já faturado |
| Conferência de 3 vias | conferido se valor ≤ faturável × (1 + tolerância%) **e** valor ≤ saldo do pedido (total − faturado) **e** existe recebimento; caso contrário DIVERGENTE |
| Divergência | aceite exige `purchase.approve`, justificativa e pessoa diferente de quem emitiu o pedido (SoD); ou recusa (cancelamento) |
| Conta a pagar | gerada só após conferência/aceite, com status "aguardando aprovação financeira"; adiantamento do pedido gera título próprio na aprovação |
| Duplicidade | (organização, fornecedor, número do documento) único no banco |
| Compromisso aberto | valor do pedido aprovado − faturado (usado no fluxo de caixa previsto e no P&L do projeto) |
| Encerramento de saldo | pedido encerrado libera o compromisso remanescente |
| Profissional PJ | pedido `PJ_PROFESSIONAL` apropriado na conta de pessoal; o custo chega ao projeto pelas horas aprovadas × custo/hora — a NF do PJ **não** soma de novo no projeto |
| Ativos | recebimento de licença/assinatura/equipamento/material cria item de ativo; licenças e assinaturas herdam a vigência do pedido como data de renovação (alerta 60 dias) |

