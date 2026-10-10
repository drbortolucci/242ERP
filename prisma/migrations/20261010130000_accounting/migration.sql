-- Contabilidade em partidas dobradas: plano de contas contábil, de-para, lançamentos e linhas
-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nature" TEXT NOT NULL,
    "analytic" BOOLEAN NOT NULL DEFAULT true,
    "parentId" TEXT,
    "referentialCode" TEXT,
    "systemKey" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LedgerMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "dedupeKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "reversalOfId" TEXT,
    "reversalReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "costCenterId" TEXT,
    "partyId" TEXT,
    "memo" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_organizationId_code_key" ON "LedgerAccount"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_organizationId_systemKey_key" ON "LedgerAccount"("organizationId", "systemKey");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerMapping_organizationId_sourceType_sourceId_key" ON "LedgerMapping"("organizationId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "JournalEntry_organizationId_companyId_date_idx" ON "JournalEntry"("organizationId", "companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_organizationId_number_key" ON "JournalEntry"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_organizationId_dedupeKey_key" ON "JournalEntry"("organizationId", "dedupeKey");

-- CreateIndex
CREATE INDEX "JournalLine_organizationId_accountId_date_idx" ON "JournalLine"("organizationId", "accountId", "date");

-- CreateIndex
CREATE INDEX "JournalLine_organizationId_entryId_idx" ON "JournalLine"("organizationId", "entryId");


-- Permissões contábeis nos perfis de sistema existentes e perfil "Contador"
UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['accounting.read','accounting.write'])) WHERE "key" IN ('org_admin','controller');
UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['accounting.read'])) WHERE "key" = 'director';
INSERT INTO "Role" ("id","organizationId","key","name","description","permissions","isSystem","createdAt","updatedAt")
SELECT 'role_acc_' || o."id", o."id", 'accountant', 'Contador', 'Plano de contas, contabilização, lançamentos, balancete, balanço, DRE e fechamento',
       ARRAY['master.read','finance.read','billing.read','inventory.read','controlling.read','fiscal.read','accounting.read','accounting.write','period.close','data.export'], true, now(), now()
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "Role" r WHERE r."organizationId" = o."id" AND r."key" = 'accountant');
