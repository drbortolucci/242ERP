# Modelo de dados

Fonte da verdade: [`prisma/schema.prisma`](../prisma/schema.prisma) (133 modelos) e migrações versionadas em `prisma/migrations`.

## Convenções

| Convenção | Regra |
|-----------|-------|
| Isolamento | Todo modelo de negócio tem `organizationId`. O cliente Prisma do contexto (`createTenantDb`) injeta o filtro em leituras e escritas; criações informam `organizationId` explicitamente. |
| Escopo de empresa | Modelos com `companyId` são filtrados pelas empresas permitidas ao usuário (`Membership.companyIds`). |
| Relações | Não há relações Prisma entre modelos de negócio (apenas ids): evita *joins* que atravessem o isolamento; leituras compostas são feitas pelos serviços. |
| Dinheiro | `Decimal(18,2)`; tarifas e preços unitários `Decimal(18,4)`; horas `Decimal(12,2)`; percentuais `Decimal(9,4)`. Nunca `float`. |
| Datas | Datas civis (vencimento, competência, apontamento) em colunas `DATE`; instantes (criação, SLA, aprovação) em `TIMESTAMPTZ` UTC. Competência = 1º dia do mês. |
| Numeração | `DocumentSequence` com `INSERT … ON CONFLICT … RETURNING` (atômica, sem lacunas por rollback quando usada na transação). |
| Idempotência | Chaves únicas no banco: `BillingLock (org, tipo, chave)`, `BillingDocument.idempotencyKey`, `Settlement.idempotencyKey`, `HourBankEntry.dedupeKey`, `ManagerialEntry.dedupeKey`, `Payable (org, sourceType, sourceId)`, `CommissionEntry (regra, origem, tipo)`, `SupplierInvoice (org, fornecedor, número)`, `BankStatementLine (conta, externalId)`, `BankTransaction.statementLineId`. |
| Histórico | Estornos são registros inversos vinculados (`reversalOfId`); documentos aprovados e snapshots (tarifas, custos/hora) não são alterados. |
| Auditoria | `AuditLog` com ator, ação, entidade, diferenças, motivo e correlação. |

## Grupos

### Plataforma SaaS
`Plan`, `Organization` (inclui `sector`, o setor de atividade), `Subscription`, `SaasInvoice`, `PlanChange`, `WebhookEvent`, `SupportAccessGrant`, `DataExport`, `Job`, `RateLimitBucket`.

### Identidade e acesso
`User`, `Session`, `PasswordResetToken`, `Membership` (perfis, empresas permitidas, tipo INTERNAL/CLIENT, parte do cliente, profissional vinculado), `Role` (permissões), `Invitation`, `ApiKey` (hash SHA-256, escopos), `Notification`, `OutboundMessage` (caixa de saída simulada), `SavedFilter`, `Favorite`.

### Estrutura e configuração
`Company` (matriz/filiais), `BusinessUnit`, `CostCenter`, `BankAccount`, `OnboardingState`, `DocumentSequence`, `OrgSetting`, `WorkCalendar`, `Holiday`, `Service`, `PipelineStage`, `LossReason`, `ProjectType` (modelo de WBS da biblioteca em `templateKey` ou próprio em `wbsTemplate`), `TeamRole`, `SeniorityLevel`, `Skill`, `PriceTable`/`PriceTableItem` (vigência), `ExpenseCategory`, `ManagerialAccount` (tipo + `systemKey` usada nas integrações internas), `PaymentTerm`, `PaymentMethod`, `ApprovalRule`/`ApprovalRequest`, `SlaPolicy`/`SlaTarget`, `DocumentTemplate`, `CustomFieldDef`, `FiscalServiceCode`, `WithholdingRule`, `IntegrationConfig` (apenas referência ao segredo), `Attachment`.

### Cadastros
`Party` (cliente, prospect, fornecedor, parceiro — papéis combináveis), `Contact`, `SupplierComplianceDoc`, `Professional` (vínculo, calendário, centro de custo, fornecedor para PJ), `ProfessionalSkill`, `CostRate` (custo/hora com vigência), `Absence`.

### Comercial
`Lead`, `Opportunity`/`OpportunityItem`, `Activity`, `Proposal`/`ProposalVersion`/`ProposalLine`, `SalesOrder`, `Contract`/`ContractItem`/`ContractRate`/`ContractMilestone`/`ContractAmendment`, `ChangeRequest`, `CustomerPurchaseOrder`, `CommissionRule`/`CommissionEntry`.

### Operação
`Project`, `ProjectBaseline`/`BaselineMonth` (versões), `ProjectTask`/`TaskDependency`, `ProjectMember`, `ProjectLog` (riscos, problemas, decisões, pendências — visibilidade ao cliente), `StatusReport`, `ProjectEstimate`, `ResourceRequest`, `Allocation` (sempre convertida em horas), `TimeEntry` (fluxo operacional + elegibilidade de faturamento + snapshots), `ExpenseAdvance`, `Expense`.

### Suprimentos
`PurchaseRequisition`/`RequisitionLine`, `Quotation`/`QuotationLine`, `PurchaseOrder`/`PurchaseOrderLine` (recebido e faturado por linha), `GoodsReceipt`/`GoodsReceiptLine`, `SupplierInvoice` (resultado da conferência de 3 vias), `SupplierEvaluation`, `Asset`/`AssetMovement`.

### AMS
`Ticket` (prazos, pausas, violações, escalonamento), `TicketComment` (PUBLIC/INTERNAL), `TicketEvent`, `KnowledgeArticle`, `HourBankEntry` (razão de horas: crédito, débito FIFO, expiração, ajuste, excedente com decisão).

### Monetização e financeiro
`Measurement`/`MeasurementItem` (origem tipo + id, projeto), `BillingLock`, `BillingDocument` (bruto, desconto, retenções, líquido), `FiscalDocument` (provedor, ambiente, tentativas), `Receivable`, `Payable`, `Settlement` (estorno por registro inverso), `Advance`/`AdvanceApplication`, `Offset`, `RecurringPayable`, `BankTransaction`, `Transfer`, `StatementImport`/`BankStatementLine`.

### Controladoria
`ManagerialEntry` (razão gerencial: conta, competência, dimensões — empresa, unidade, centro de custo, cliente, contrato, projeto, serviço, profissional, fornecedor —, origem, regra aplicada, chave de idempotência), `AccountingPeriod`, `Budget`/`BudgetLine`, `AllocationRule` (versionada)/`AllocationRun`, `PayrollImport`/`PayrollImportLine`.

## Rastreabilidade ponta a ponta

```
Opportunity ─► Proposal(Version) ─► SalesOrder ─► Contract ─► Project ─► Allocation
                                                     │            └► TimeEntry ─┐
                                                     ├► ContractMilestone ──────┤
                                                     ├► HourBankEntry (AMS) ────┤
                                                     └► Expense ────────────────┤
                                                                                ▼
                                     MeasurementItem (sourceType + sourceId) + BillingLock
                                                     ▼
                       BillingDocument ─► FiscalDocument      Receivable ─► Settlement ─► BankTransaction ◄─ BankStatementLine
                                                     ▼
                                     ManagerialEntry (dedupeKey, sourceType, sourceId)
PurchaseRequisition ─► Quotation ─► PurchaseOrder ─► GoodsReceipt ─► SupplierInvoice ─► Payable ─► Settlement
                                                                                  └► ManagerialEntry (projeto/CC)
```
