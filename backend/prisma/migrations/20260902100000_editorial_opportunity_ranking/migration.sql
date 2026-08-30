-- Extend the append-only decision history with a structured opportunity snapshot.
ALTER TABLE "EditorialDecision" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'INSUFFICIENT_DATA';
ALTER TABLE "EditorialDecision" ADD COLUMN "candidateType" TEXT;
ALTER TABLE "EditorialDecision" ADD COLUMN "candidateKey" TEXT;
ALTER TABLE "EditorialDecision" ADD COLUMN "opportunityScore" JSONB;
ALTER TABLE "EditorialDecision" ADD COLUMN "favorableEvidence" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "EditorialDecision" ADD COLUMN "contraryEvidence" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "EditorialDecision" ADD COLUMN "constraints" JSONB NOT NULL DEFAULT '[]';

CREATE INDEX "EditorialDecision_category_createdAt_idx" ON "EditorialDecision"("category", "createdAt");
CREATE INDEX "EditorialDecision_candidateType_candidateKey_idx" ON "EditorialDecision"("candidateType", "candidateKey");
