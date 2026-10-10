# Guia de configuração

Ordem recomendada para colocar uma empresa de serviços em operação. Todas as telas estão em **Configurador** (`/app/config`) e **Administração** (`/app/admin`); cada alteração é auditada.

## 0. Setor de atividade e terminologia
O 242ERP atende qualquer empresa de serviços; consultorias são a especialidade. O **setor** é escolhido no cadastro e pode ser trocado em **Configurador › Setor de atividade e terminologia** (`/app/config/setor`, permissão `settings.manage`).

| Setor | Exemplos de tipos de projeto | Termos principais |
|-------|------------------------------|-------------------|
| Consultoria e serviços de TI (padrão) | Implementação ERP, rollout, integração, AMS | Consultores, Chamados, AMS |
| Consultoria empresarial e de gestão | Diagnóstico, planejamento estratégico, mentoria, assessoria recorrente | Solicitações, Assessoria recorrente |
| Engenharia, arquitetura e serviços técnicos | Projeto técnico, viabilidade, gerenciamento de obra, laudo, manutenção | Ordens de serviço, Manutenção |
| Agências de marketing, comunicação e design | Campanha, branding, site, fee mensal | Jobs, Solicitações, Fee mensal |
| Escritórios contábeis, jurídicos e de auditoria | Rotina mensal, caso/processo, auditoria, parecer | Trabalhos, Atendimento recorrente |
| Manutenção, facilities e serviços em campo | Instalação, manutenção, vistoria, equipe residente | Técnicos, Ordens de serviço, Manutenção |
| Desenvolvimento de software e produtos digitais | Desenvolvimento, discovery/UX, squad, sustentação | Sustentação, Produto/Funcionalidade |
| Educação corporativa, treinamentos e eventos | Curso/turma, programa, evento | Programas, Instrutores |
| Outros serviços (genérico) | Projeto, serviço recorrente, alocação | Atendimentos, Serviços recorrentes |

- **O que o setor muda**: apenas pontos de partida editáveis — tipos de projeto e modelos de WBS, papéis de equipe, catálogo de serviços (com modelo comercial e conta de receita), categorias de despesa, competências — e a terminologia do menu e das telas principais. Cálculos, controles, aprovações, faturamento e controladoria são os mesmos.
- **Trocar de setor** acrescenta somente o que falta (por nome/código); nada existente é alterado ou removido. Desative nos cadastros o que não usar.
- **Terminologia**: personalize projeto, profissional, chamado, área de atendimento recorrente, saldos e os campos "sistema"/"módulo" do chamado. Campo vazio volta ao termo do setor.
- **Modelos de WBS**: cada tipo de projeto usa um modelo da biblioteca ou um **modelo próprio** em texto (`Fase | Item | tipo | % | aceite`, soma 100%).
- **Contratos recorrentes com franquia** (modelo "Recorrente com franquia") servem a AMS, contratos de manutenção, fee mensal de agência e honorários mensais: franquia de horas, consumo, excedente e níveis de serviço funcionam igual em todos os setores.
- Fora do escopo atual: agendamento de atendimentos por horário (clínicas, salões) e controle de estoque/produção.

## 1. Organização e acesso
1. **Cadastro** (`/cadastro`): cria a organização, o administrador e o período de avaliação com a configuração padrão (perfis, plano de contas gerencial, funil, calendário, SLA, alçadas).
2. **Onboarding** (`/app/onboarding`): confirme o setor de atividade; empresa matriz (CNPJ validado), filiais, unidades de negócio, centros de custo, contas bancárias, checklist. Pode ser salvo e retomado.
3. **Usuários e perfis** (`/app/admin/usuarios`): convide usuários com perfis-modelo (diretoria, comercial, PMO, atendimento/AMS, recursos, financeiro, controladoria, compras, profissional de operação, cliente) e, se necessário, restrinja as empresas que cada um enxerga. Ative MFA (TOTP) no perfil do usuário.
4. **Assinatura** (`/app/admin/assinatura`): plano e limites (usuários, empresas, armazenamento). Limites são verificados no servidor.

## 2. Cadastros-base
| Item | Onde | Observação |
|------|------|------------|
| Serviços | Configurador › Serviços | Base de precificação, faturamento e código de serviço fiscal |
| Papéis, senioridades, competências | Configurador | Usados em propostas, alocação e sugestões |
| Tabela de preços | Configurador › Tabelas de preço | Vigência por item; contratos guardam *snapshot* |
| Calendários e feriados | Configurador › Calendários | Capacidade (horas/dia) e janela de atendimento do SLA |
| Profissionais | Cadastros › Profissionais | Vínculo (CLT/PJ/parceiro), calendário, centro de custo, custo/hora com vigência |
| Clientes, fornecedores, parceiros | Cadastros | Uma parte pode ter vários papéis; importação por planilha com prévia de erros |

## 3. Políticas e alçadas
- **Alçadas** (Configurador › Políticas): regras por documento (proposta por desconto/margem/valor, pedido de compra, despesa, conta a pagar, medição) e permissão exigida. Segregação de funções: quem solicita não aprova.
- **Horas**: máximo por dia, frações, hora extra, bloqueio após N dias.
- **Módulos**: habilite/desabilite módulos dentro do contratado no plano.

## 4. Fiscal e financeiro (responsável fiscal)
O sistema **não** traz alíquotas, códigos de serviço ou regras de retenção. Cadastre e valide:
- **Códigos de serviço municipais** por empresa e serviço, com vigência e responsável pela validação.
- **Regras de retenção** (código, alíquota, base mínima, vigência) — aplicadas automaticamente na emissão do documento de cobrança.
- **Condições de pagamento** (parcelas em % somando 100).
- **Integração NFS-e** (Configurador › Integrações): provedor e nome do segredo no cofre. Em desenvolvimento/teste a emissão é sempre simulada.

## 4.1 Estoque
1. Cadastre os depósitos (Estoque › Depósitos) por empresa. Evite "aceita saldo negativo": distorce o custo médio.
2. Cadastre os produtos (código, unidade, preço, mínimo/máximo). NCM e origem são informados pela empresa; o sistema não valida classificação fiscal.
3. Lance o saldo inicial de cada produto/depósito (Estoque › Movimentos › Saldo inicial) com o custo unitário de implantação.
4. Compras de mercadorias: no pedido de compra, escolha o produto e o depósito de entrada; o recebimento dá entrada no estoque.
5. Atribua o perfil "Estoque e expedição" a quem recebe, conta e entrega mercadorias.

## 4.2 Cobrança bancária
1. Configurador › Integrações › "Bancos e cobrança": em homologação/desenvolvimento o provedor é sempre o simulado. Em produção, um provedor real precisa estar implementado, homologado com o banco e com as credenciais no cofre do ambiente (informe só o nome do segredo).
2. Defina `BANKING_WEBHOOK_SECRET` no ambiente e cadastre a URL `/api/webhooks/cobranca/{provider}` no provedor.
3. Multa e juros são informados na emissão conforme o contrato com o cliente; o sistema não define percentuais.
4. Em Financeiro › Conciliação, crie regras para lançamentos recorrentes do extrato (tarifas, rendimentos) e use "Conciliar automaticamente".

## 4.3 Fiscal
1. Atribua o perfil "Responsável fiscal" ao contador/consultor tributário da empresa.
2. Fiscal › Regras de produtos: cadastre CFOP, CST/CSOSN e alíquotas por produto ou NCM, com vigência e fundamentação. O responsável registra a validação (nome e registro profissional); alterações exigem nova validação.
3. Códigos de serviço municipais (NFS-e) e retenções continuam no Configurador › Fiscal.
4. Emissão real exige provedor homologado configurado em produção; fora dele todos os documentos são simulados (prefixo SIM, sem validade fiscal).

## 4.4 Contabilidade
1. Atribua o perfil "Contador" ao responsável contábil.
2. Contabilidade › Plano de contas: organizações novas recebem o plano sugerido; nas existentes, use "Criar plano sugerido". O contador revisa nomes e códigos, informa o código referencial (SPED) e cria subcontas analíticas.
3. Faça o de-para das contas bancárias e das contas gerenciais de despesa/receita para contas contábeis analíticas.
4. Lance os saldos de implantação (Contabilidade › Lançamentos › lançamento manual) contra "Saldos de implantação"; os saldos iniciais das contas bancárias e do estoque já são lançados automaticamente.
5. Ao fim de cada mês: "Contabilizar mês" por empresa, confira o balancete e feche o período (Controladoria › Fechamento).

## 5. Contratos e AMS
- Modelo comercial, método de reconhecimento de receita, exigência de OC e de aprovação do cliente (horas/medições), alíquota de dedução gerencial (informada pela empresa).
- AMS: política de SLA, mensalidade, franquia, banco de horas (não acumula / acumula N meses / pré-pago), política de excedente (cobrar, exigir aprovação, absorver), limite de alerta de saldo.

## 6. Controladoria
- Plano de contas gerencial: contas com `systemKey` são usadas pelas integrações internas (custo de pessoal, absorção, terceiros, receitas, deduções…). Não remova essas chaves.
- **Regras de reconhecimento**: registre a aprovação em Controladoria › Fechamento.
- Rateios (Controladoria › Rateios), orçamento (Controladoria › Orçamentos), importação de folha consolidada (Controladoria › Razão).

## 7. Portal do cliente
Convide contatos do cliente com o perfil **Cliente (portal)** ou **Aprovador do cliente** vinculando a parte. Eles acessam apenas `/portal`, com dados da própria empresa.

## 8. API
Administração › Chaves de API: crie chaves com escopos mínimos; a chave é exibida uma única vez. Referência em [INTEGRACOES.md](INTEGRACOES.md).
