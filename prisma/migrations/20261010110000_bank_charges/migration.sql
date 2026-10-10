-- Cobrança bancária (boleto/PIX), eventos e regras de conciliação automática
-- CreateTable
CREATE TABLE "BankCharge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(18,2) NOT NULL,
    "dueDate" DATE NOT NULL,
    "finePct" DECIMAL(9,4),
    "interestPctMonth" DECIMAL(9,4),
    "digitableLine" TEXT,
    "pixCode" TEXT,
    "paymentUrl" TEXT,
    "paidAt" DATE,
    "paidAmount" DECIMAL(18,2),
    "settlementId" TEXT,
    "lastError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BankCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankChargeEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankChargeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "name" TEXT NOT NULL,
    "contains" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'OUT',
    "description" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankCharge_organizationId_status_idx" ON "BankCharge"("organizationId", "status");

-- CreateIndex
CREATE INDEX "BankCharge_provider_externalId_idx" ON "BankCharge"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "BankCharge_organizationId_idempotencyKey_key" ON "BankCharge"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "BankCharge_organizationId_number_key" ON "BankCharge"("organizationId", "number");

-- CreateIndex
CREATE INDEX "BankChargeEvent_organizationId_chargeId_idx" ON "BankChargeEvent"("organizationId", "chargeId");

