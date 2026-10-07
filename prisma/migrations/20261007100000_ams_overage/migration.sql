-- AlterTable
ALTER TABLE "HourBankEntry" ADD COLUMN     "decidedAt" TIMESTAMPTZ(3),
ADD COLUMN     "decidedById" TEXT,
ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "overageStatus" TEXT;

