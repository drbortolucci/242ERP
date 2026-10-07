# Guia de configuração

Ordem recomendada para colocar uma consultoria em operação. Todas as telas estão em **Configurador** (`/app/config`) e **Administração** (`/app/admin`); cada alteração é auditada.

## 1. Organização e acesso
1. **Cadastro** (`/cadastro`): cria a organização, o administrador e o período de avaliação com a configuração padrão (perfis, plano de contas gerencial, funil, calendário, SLA, alçadas).
2. **Onboarding** (`/app/onboarding`): empresa matriz (CNPJ validado), filiais, unidades de negócio, centros de custo, contas bancárias, checklist. Pode ser salvo e retomado.
3. **Usuários e perfis** (`/app/admin/usuarios`): convide usuários com perfis-modelo (diretoria, comercial, PMO, AMS, recursos, financeiro, controladoria, compras, consultor, cliente) e, se necessário, restrinja as empresas que cada um enxerga. Ative MFA (TOTP) no perfil do usuário.
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
