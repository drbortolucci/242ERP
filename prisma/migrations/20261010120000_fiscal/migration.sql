-- Fiscal: documento fiscal genérico (NFS-e e NF-e), cancelamento e regras fiscais de produto informadas/validadas pela empresa
-- AlterTable
ALTER TABLE "FiscalDocument" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "canceledAt" TIMESTAMPTZ(3),
ADD COLUMN     "docType" TEXT NOT NULL DEFAULT 'NFSE',
ADD COLUMN     "productOrderId" TEXT,
ALTER COLUMN "billingDocumentId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "FiscalProductRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productId" TEXT,
    "ncm" TEXT,
    "cfop" TEXT NOT NULL,
    "icmsCst" TEXT,
    "icmsRatePct" DECIMAL(9,4),
    "ipiCst" TEXT,
    "ipiRatePct" DECIMAL(9,4),
    "pisCst" TEXT,
    "pisRatePct" DECIMAL(9,4),
    "cofinsCst" TEXT,
    "cofinsRatePct" DECIMAL(9,4),
    "notes" TEXT,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "validatedBy" TEXT,
    "validatedAt" TIMESTAMPTZ(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FiscalProductRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FiscalProductRule_organizationId_companyId_idx" ON "FiscalProductRule"("organizationId", "companyId");

-- CreateIndex
CREATE INDEX "FiscalDocument_organizationId_status_idx" ON "FiscalDocument"("organizationId", "status");


-- Permissões fiscais nos perfis de sistema existentes e perfil "Responsável fiscal"
UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['fiscal.read','fiscal.manage','fiscal.validate','fiscal.issue'])) WHERE "key" = 'org_admin';
UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['fiscal.read','fiscal.issue'])) WHERE "key" = 'finance';
UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['fiscal.read'])) WHERE "key" IN ('company_admin','director','controller');
INSERT INTO "Role" ("id","organizationId","key","name","description","permissions","isSystem","createdAt","updatedAt")
SELECT 'role_fis_' || o."id", o."id", 'fiscal', 'Responsável fiscal', 'Regras fiscais (validação), códigos de serviço, retenções e documentos fiscais',
       ARRAY['master.read','billing.read','finance.read','inventory.read','fiscal.read','fiscal.manage','fiscal.validate','fiscal.issue'], true, now(), now()
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "Role" r WHERE r."organizationId" = o."id" AND r."key" = 'fiscal');
