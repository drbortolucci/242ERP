# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) · Versionamento semântico.

## [0.1.0] — Etapa 1: Fundação SaaS
### Adicionado
- Modelo de dados completo (todas as etapas) e migração inicial.
- Isolamento multi-tenant por construção (cliente Prisma escopado por organização e empresa).
- Autenticação (argon2id, sessão httpOnly, bloqueio, recuperação de acesso, convites, MFA TOTP, rate limit).
- Perfis e permissões por ação/módulo, alçadas de aprovação, segregação de funções, auditoria.
- Organizações, planos, avaliação, limites no servidor, upgrade/downgrade, cancelamento/reativação, retenção, política de inadimplência, webhooks idempotentes (provedor simulado).
- Onboarding salvável, empresas/filiais, unidades, centros de custo, contas bancárias, calendários e feriados.
- Configurador central, cadastros básicos, importação por planilha com prévia de erros, exportação CSV/XLSX.
- Anexos com validação por conteúdo, exportação integral de dados, acesso de suporte temporário.
- Painel da plataforma (métricas, organizações, planos).
- CI (lint, tipos, testes, migrações, seed, build, E2E) e Docker Compose.

## [0.2.0] — Etapa 2: Comercial
### Adicionado
- CRM: leads (qualificação e conversão), oportunidades multi-serviço, funil kanban/lista, atividades e interações, indicadores (pipeline bruto/ponderado, conversão, ciclo, sem atividade, previsão, vendas por responsável/cliente/serviço).
- Propostas versionadas com precificação (receita, custos, MC, markup), alçadas de aprovação com SoD, imutabilidade da versão aprovada, PDF, registro de aceite.
- Pedidos de venda (carteira), contratos com snapshot de itens/tarifas, reajuste com vigência, marcos, OCs do cliente, mudanças de escopo e aditivos aprovados, saldos (contratado/executado/faturado/recebido/disponível), alertas, renovação/upsell, comissões.
- Visão 360° do cliente.

## [0.3.0] — Etapa 3: Operação
### Adicionado
- Projetos vinculados a contrato com linha de base versionada (distribuição mensal), WBS gerada por modelos (implementação, diagnóstico, rollout, integração, treinamento, advisory, alocação, AMS), dependências, kanban, Gantt, riscos/problemas/decisões/pendências, relatórios de status, aceites de entregáveis, ETC e previsão ao término, EVM condicional, encerramentos operacional e financeiro separados; portfólio com sinais de risco.
- Recursos: solicitações, sugestões por competência/disponibilidade, alocação por %/horas por dia/total de horas convertida em horas pelo calendário, conflitos e exceções autorizadas, grade semanal/mensal de capacidade x alocado x apontado x faturável.
- Horas: fluxo rascunho→enviado→aprovado (interno)→cliente→elegível, rejeição com motivo, limites, duplicidade, hora extra, períodos fechados, snapshots de custo/tarifa, ajustes rastreáveis.
- Despesas: custo x devido ao profissional x cobrável, comprovante obrigatório, alçadas, conta a pagar de reembolso, adiantamentos e prestação de contas.
- Minha área (portal do consultor).

## [0.4.0] — Etapa 4: Suprimentos
### Adicionado
- Requisições com verificação de orçamento (projeto/centro de custo), cotações e mapa comparativo (menor preço total, prazo e por item).
- Pedidos de compra e contratações (avulsa, subcontratação, profissional PJ, recorrente com vigência, licença), alçadas com SoD, adiantamento ao fornecedor, cancelamento e encerramento de saldo.
- Recebimentos/aceites de serviço e devoluções; conferência de 3 vias com tolerância; tratamento de divergência (aceite justificado com SoD ou recusa); contas a pagar geradas para aprovação financeira.
- Ativos, licenças, assinaturas e materiais com movimentações e alertas de renovação.
- Visão 360° do fornecedor; documentação de conformidade com validade; avaliações.
- Apropriação no projeto: terceiros pela NF aprovada, PJ pelas horas (sem duplicidade), compromissos abertos.
### Corrigido
- Comprometido do projeto: pedidos encerrados liberam saldo e o saldo por pedido nunca é negativo.

## [0.5.0] — Etapa 5: AMS
### Adicionado
- Chamados (incidente, requisição, problema, mudança) com prioridade por impacto × urgência, SLA de resposta e solução em minutos úteis (calendário, janela de atendimento, feriados, fuso), pausas, escalonamento, violação, reabertura, encerramento automático, vínculo a problema e satisfação.
- Base de conhecimento (interna/visível ao cliente) com busca e sugestão de artigos no chamado.
- Banco de horas: franquias mensais (não acumula, acumula por N meses, pré-pago), consumo FIFO por vencimento, excedente valorizado com política (cobrar, exigir aprovação, absorver), expiração, ajustes e compras pré-pagas, alerta de saldo baixo.
- Apuração automática na aprovação de horas e diária pelo worker; varredura de SLA a cada 5 minutos; contexto de sistema auditado para tarefas agendadas.
- Horas apontadas no chamado compõem o custo do projeto de sustentação do contrato.

## [0.6.0] — Etapa 6: Monetização e financeiro
### Adicionado
- Motor de medição com origem rastreável (horas, marcos, mensalidades de alocação e AMS, excedente AMS, despesas, ajustes) e trava única por origem no banco; aprovação interna (SoD) e do cliente.
- Documento de cobrança com faturamento parcial, desconto, OC do cliente com controle de saldo, retenções configuradas pela empresa, parcelas pela condição de pagamento, PDF interno (não fiscal), cancelamento controlado e comissões por faturamento.
- Adaptador de NFS-e com provedor simulado, idempotência, tentativas e webhook autenticado.
- Contas a receber/pagar: títulos avulsos, aprovação de CP com SoD, liquidação parcial com juros/multa/desconto, estorno vinculado, adiantamentos e aplicação, compensação autorizada, aging, contas recorrentes (job), comissões por recebimento.
- Tesouraria: saldos, transferências, importação de extrato CSV/OFX sem duplicidade, conciliação 1:1, lançamento de tarifas, fluxo de caixa realizado e previsto.
- Job `contracts.alerts` (agendado e antes sem manipulador) passa a notificar os responsáveis.

## [0.7.0] — Etapa 7: Controladoria
### Adicionado
- Razão gerencial idempotente por empresa/competência: custo de horas com absorção de pessoal (sem duplicar a folha), terceiros, despesas, títulos recorrentes, receita por método do contrato (medição, marcos, linear, % de conclusão por horas), deduções gerenciais, resultado financeiro, comissões, folha importada; estorno automático de origens canceladas; job diário.
- Rateios versionados (percentual fixo, horas, receita) com soma preservada, execução única por competência e estorno.
- Orçamentos e forecasts versionados, orçado × realizado.
- DRE gerencial com filtros (empresa, centro de custo, unidade) e navegação até o razão e a origem.
- P&L de projetos: original × revisado × realizado × previsto.
- Fechamento com checklist de pendências, bloqueio de operações e reabertura autorizada e auditada; exportação contábil (CSV); registro de aprovação das regras de reconhecimento.

## [0.8.0] — Etapa 8: Portais e dashboards
### Adicionado
- Portal do cliente (`/portal`) com camada de leitura restrita à parte autorizada: início, chamados (abertura, conversa pública, confirmação/reabertura, avaliação), aprovações de horas, medições (aprovar/recusar) e entregáveis, projetos (status, riscos/decisões marcados como visíveis), financeiro (documentos de cobrança, títulos, NFS-e, PDF), base de conhecimento.
- Recusa de medição pelo cliente com motivo (volta ao rascunho para correção).
- PDF do documento de cobrança acessível ao cliente apenas para a própria parte.
- Painel inicial por perfil com indicadores rastreáveis até a tela de origem.

## [1.0.0] — Etapa 9: Integrações e produção
### Adicionado
- API pública v1 por chave (hash SHA-256, escopos, limite de taxa por chave, auditoria com a chave como ator): clientes, contratos, projetos, chamados (leitura e abertura) e títulos a receber.
- Tela de chaves de API (exibição única do segredo, revogação).
- Verificação de configuração na inicialização da aplicação e do worker (bloqueia segredo fraco/de exemplo e URL sem HTTPS em produção); avisos expostos em `/api/health`.
- Cabeçalho `Strict-Transport-Security`.
- Documentação: modelo de dados, guia de configuração, fluxos operacionais, integrações/API/limitações, implantação/backup/checklist de produção.


### Corrigido (auditoria completa do código)
- **Dinheiro e regras**: cancelamento/recusa de medição respeitam período fechado; razão gerencial (% de conclusão acumulado só até a competência, linear sem duplicar itens de horas, NF de PJ fora do projeto, marcos no fuso da organização); ajuste de horas faturadas volta a ser elegível e reapura o banco de horas; horas negativas devolvem crédito à franquia; estornos de aplicação de adiantamento e de compensação com trava e troca de situação condicional; conciliação atômica (linha e transação) e lançamento a partir do extrato na mesma transação; fluxo de caixa em decimal exato e compromissos de compra líquidos de adiantamento; total do pedido de compra arredondado por linha; cancelamento de pedido de compra trata adiantamento e aprovações pendentes; cancelamento de NF de fornecedor estorna exatamente o que foi apropriado; estorno de comissão já paga gera débito em vez de alterar o pago; saldo de OC do cliente com trava; despesas só abatem adiantamento ativo do mesmo profissional/empresa.
- **Segurança**: administradores só concedem permissões sensíveis que possuem e apenas dentro das próprias empresas, sem alterar o próprio acesso; usuários do portal recebem apenas permissões de portal; chaves de API exigem alcance total, escopos dentro das permissões do criador e deixam de valer se o criador perder o acesso; exportação integral apenas para administrador interno com acesso a todas as empresas; segredos de webhook de exemplo recusados fora de desenvolvimento/teste; apuração do banco de horas exige permissão; escopo de empresa verificado em atividades, entregáveis, registros, marcos e anexos; organização suspensa/cancelada bloqueia todas as escritas restantes; MFA ativo não é desativado ao reconfigurar; redirecionamento pós-login aceita apenas caminhos internos; módulos fora do plano bloqueados também por URL.
- **Interface**: formulários com `method="post"` (sem vazamento de dados na URL antes da hidratação) e ids únicos (`useId`); Enter em campos de motivo não aprova; custo de referência oculto para quem não vê custos; P&L e fechamento com permissões coerentes; links de títulos corrigidos; linhas da oportunidade com chave estável; alocação a partir de solicitação em total de horas; tela de perfis renderiza um perfil por vez (página ~10× menor; elimina o erro intermitente de hidratação #418 observado em páginas muito grandes — ver nota técnica em `docs/BACKLOG.md`).

## [1.3.0] — Cobrança bancária e conciliação automática
### Adicionado
- Cobrança de títulos a receber por boleto registrado ou PIX com vencimento, a partir do título: valor do saldo em aberto, multa e juros informados conforme contrato, novo vencimento curto para título vencido, uma cobrança ativa por título.
- Adaptador de provedor de cobrança (simulado em desenvolvimento e homologação; códigos de teste não pagáveis) e webhook autenticado por HMAC com baixa automática: liquidação do título na conta da cobrança, valor pago acima do saldo como juros, pagamento parcial mantém o saldo, pagamento de cobrança cancelada fica para tratamento manual; idempotente.
- Financeiro › Cobranças bancárias (lista, filtros, totais em cobrança) e trilha de eventos por cobrança.
- Conciliação automática do extrato: linha com único movimento do livro de mesmo valor em até 3 dias; regras por descrição (ex.: tarifas, rendimentos) que lançam e conciliam; o restante fica para tratamento manual.

## [1.2.0] — Estoque e vendas de produtos
### Adicionado
- Produtos (mercadoria, material de uso/consumo, produção própria) com unidade, categoria, preço de venda, estoque mínimo/máximo, código de barras, NCM e origem informados pela empresa, contas gerenciais de receita e custo.
- Depósitos por empresa; saldo por produto e depósito com reserva; custo médio móvel com movimentos imutáveis, cronológicos e estornáveis (kardex).
- Entradas por compra: itens de estoque no pedido de compra, recebimento dá entrada no depósito ao preço do pedido; devolução a fornecedor. Itens de estoque não viram ativos nem custo na compra.
- Ajustes, consumo apropriado a projeto/centro de custo, saldo inicial de implantação, transferências entre depósitos, inventário (contagem física) com ajuste das diferenças.
- Pedidos de venda de produtos: rascunho → confirmado (reserva) → entregue (baixa ao custo médio, títulos a receber pela condição de pagamento) → cancelamento com retorno ao estoque.
- Razão gerencial: receita de venda de mercadorias, custo das mercadorias vendidas, perdas e ajustes de estoque, consumo em projetos.
- Posição de estoque, sugestão de reposição, perfil "Estoque e expedição", permissões `inventory.*` e `sales.goods`, módulo `inventory` nos planos Professional e Enterprise.
### Corrigido
- Links para páginas sem acesso (permissão ou módulo fora do plano) passam a aparecer como texto, com um mapa central de acesso às rotas.
- Cadastros › Serviços deixava de abrir (erro 500) para perfis sem permissão de configuração; agora mostra o catálogo para consulta.
- Título a pagar de adiantamento de despesas apontava para uma página inexistente.
- Produção: aplicação conectada ao pooler em modo transação (o modo sessão esgotava o limite de clientes).

## [1.1.0] — Multissetor (empresas de serviços)
### Adicionado
- Setor de atividade escolhido no cadastro e alterável no configurador: consultoria e TI (padrão e especialidade), consultoria de gestão, engenharia/arquitetura, agências, escritórios contábeis/jurídicos, manutenção e serviços em campo, software, educação e serviços em geral.
- Perfis de setor com tipos de projeto, biblioteca de modelos de WBS (25 modelos), papéis, serviços, categorias de despesa e competências; aplicação idempotente que só acrescenta o que falta.
- Terminologia por setor e personalizável (projeto, profissional, chamado, área de atendimento recorrente, saldos, campos do chamado) no menu, painel, portal e telas principais.
- Modelo de WBS próprio por tipo de projeto (texto `Fase | Item | tipo | % | aceite`, validação da soma).
- Migração `20261009100000_sector_profiles`. Segunda organização de demonstração passa a ser do setor de engenharia.
### Alterado
- Textos genéricos para empresas de serviços (cadastro, configurador, planos, perfil "Profissional (operação)", modelo comercial "Recorrente com franquia (AMS, manutenção, fee)", nomes do plano de contas padrão de novas organizações).
