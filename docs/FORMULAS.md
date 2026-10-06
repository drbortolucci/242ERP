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
