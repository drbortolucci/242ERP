-- Estoque e produtos: produtos, depósitos, saldos, movimentos (custo médio), inventário e pedidos de venda de produtos
-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "warehouseId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "productId" TEXT;

-- AlterTable
ALTER TABLE "Receivable" ADD COLUMN     "productOrderId" TEXT;

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'GOODS',
    "unit" TEXT NOT NULL DEFAULT 'UN',
    "barcode" TEXT,
    "ncm" TEXT,
    "origin" TEXT,
    "salePrice" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lastCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "minStock" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "maxStock" DECIMAL(14,4),
    "tracksStock" BOOLEAN NOT NULL DEFAULT true,
    "revenueAccountId" TEXT,
    "costAccountId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "allowNegative" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "avgCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lastMovementAt" DATE,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitCost" DECIMAL(18,6) NOT NULL,
    "totalCost" DECIMAL(18,2) NOT NULL,
    "balanceQty" DECIMAL(14,4) NOT NULL,
    "balanceAvgCost" DECIMAL(18,6) NOT NULL,
    "balanceValue" DECIMAL(18,2) NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "projectId" TEXT,
    "costCenterId" TEXT,
    "partyId" TEXT,
    "reversalOfId" TEXT,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "postedById" TEXT,
    "postedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCountLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "systemQty" DECIMAL(14,4) NOT NULL,
    "countedQty" DECIMAL(14,4),
    "movementId" TEXT,

    CONSTRAINT "InventoryCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "orderDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "paymentTermId" TEXT,
    "productsAmount" DECIMAL(18,2) NOT NULL,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "freightAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "costAmount" DECIMAL(18,2),
    "customerPo" TEXT,
    "notes" TEXT,
    "deliveredAt" DATE,
    "fiscalStatus" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProductOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOrderLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL,
    "unitCost" DECIMAL(18,6),
    "costAmount" DECIMAL(18,2),

    CONSTRAINT "ProductOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_organizationId_name_key" ON "ProductCategory"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_organizationId_code_key" ON "Product"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_organizationId_code_key" ON "Warehouse"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_organizationId_productId_warehouseId_key" ON "StockBalance"("organizationId", "productId", "warehouseId");

-- CreateIndex
CREATE INDEX "StockMovement_organizationId_productId_warehouseId_date_idx" ON "StockMovement"("organizationId", "productId", "warehouseId", "date");

-- CreateIndex
CREATE INDEX "StockMovement_organizationId_sourceType_sourceId_idx" ON "StockMovement"("organizationId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_organizationId_idempotencyKey_key" ON "StockMovement"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCount_organizationId_number_key" ON "InventoryCount"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCountLine_countId_productId_key" ON "InventoryCountLine"("countId", "productId");

-- CreateIndex
CREATE INDEX "ProductOrder_organizationId_status_idx" ON "ProductOrder"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOrder_organizationId_number_key" ON "ProductOrder"("organizationId", "number");


-- Dados: organizações existentes recebem o módulo, as permissões e as contas gerenciais do sistema

-- Planos intermediário e superior passam a incluir o módulo de estoque
UPDATE "Plan" SET "modules" = array_append("modules", 'inventory') WHERE "rank" >= 2 AND NOT ('inventory' = ANY("modules"));
-- Organizações que restringiram os módulos habilitados: o novo módulo entra habilitado (pode ser desligado no configurador)
UPDATE "OrgSetting" SET "value" = jsonb_set("value", '{enabled}', ("value"->'enabled') || '["inventory"]'::jsonb)
 WHERE "key" = 'modules' AND jsonb_typeof("value"->'enabled') = 'array' AND NOT ("value"->'enabled') ? 'inventory';

-- Permissões nos perfis de sistema
UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['inventory.read','inventory.write','inventory.adjust','sales.goods'])) WHERE "key" = 'org_admin';
UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['inventory.read'])) WHERE "key" IN ('company_admin','director','finance','controller');
UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['inventory.read','sales.goods'])) WHERE "key" = 'sales';
UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['inventory.read','inventory.write'])) WHERE "key" = 'purchasing';
INSERT INTO "Role" ("id","organizationId","key","name","description","permissions","isSystem","createdAt","updatedAt")
SELECT 'role_stk_' || o."id", o."id", 'stock_keeper', 'Estoque e expedição', 'Produtos, depósitos, recebimentos, inventário e entregas',
       ARRAY['master.read','inventory.read','inventory.write','inventory.adjust','purchase.receive','sales.goods','project.read'], true, now(), now()
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "Role" r WHERE r."organizationId" = o."id" AND r."key" = 'stock_keeper');

-- Contas gerenciais do sistema (código alternativo se o código padrão já estiver em uso pela organização)
INSERT INTO "ManagerialAccount" ("id","organizationId","code","name","type","parentId","systemKey","active")
SELECT 'acc_' || a.sk || '_' || o."id", o."id",
       CASE WHEN EXISTS (SELECT 1 FROM "ManagerialAccount" x WHERE x."organizationId" = o."id" AND x."code" = a.code) THEN a.code || '.S' ELSE a.code END,
       a.name, a.type::"AccountType",
       (SELECT p."id" FROM "ManagerialAccount" p WHERE p."organizationId" = o."id" AND p."code" = a.parent LIMIT 1),
       a.sk, true
FROM "Organization" o
CROSS JOIN (VALUES
  ('REVENUE_GOODS', '1.05', 'Receita de venda de mercadorias e produtos', 'REVENUE', '1'),
  ('COGS', '3.05', 'Custo das mercadorias e produtos vendidos', 'DIRECT_COST', '3'),
  ('INVENTORY_ADJUSTMENTS', '3.06', 'Perdas e ajustes de estoque', 'DIRECT_COST', '3')
) AS a(sk, code, name, type, parent)
WHERE NOT EXISTS (SELECT 1 FROM "ManagerialAccount" m WHERE m."organizationId" = o."id" AND m."systemKey" = a.sk);
