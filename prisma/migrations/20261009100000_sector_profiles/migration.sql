-- Setor de atividade da organização e modelo de WBS próprio por tipo de projeto
ALTER TABLE "Organization" ADD COLUMN "sector" TEXT NOT NULL DEFAULT 'CONSULTING_IT';
ALTER TABLE "ProjectType" ADD COLUMN "wbsTemplate" JSONB;
