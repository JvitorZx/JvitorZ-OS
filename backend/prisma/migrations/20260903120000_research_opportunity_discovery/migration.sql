-- CreateTable
CREATE TABLE "ResearchHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "executionKey" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "normalizedQuery" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "subjectType" TEXT,
    "subject" TEXT,
    "sources" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "quality" TEXT NOT NULL,
    "freshness" TEXT NOT NULL,
    "limitations" JSONB NOT NULL,
    "context" JSONB,
    "researchedAt" DATETIME NOT NULL,
    "validUntil" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResearchHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchOpportunity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "researchHistoryId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sources" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "freshness" TEXT NOT NULL,
    "compatibility" REAL NOT NULL,
    "confidence" REAL NOT NULL,
    "risks" JSONB NOT NULL,
    "gaps" JSONB NOT NULL,
    "nextInvestigation" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResearchOpportunity_researchHistoryId_fkey" FOREIGN KEY ("researchHistoryId") REFERENCES "ResearchHistory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ResearchHistory_executionKey_key" ON "ResearchHistory"("executionKey");
CREATE INDEX "ResearchHistory_projectId_researchedAt_idx" ON "ResearchHistory"("projectId", "researchedAt");
CREATE INDEX "ResearchHistory_cacheKey_researchedAt_idx" ON "ResearchHistory"("cacheKey", "researchedAt");
CREATE INDEX "ResearchHistory_quality_freshness_idx" ON "ResearchHistory"("quality", "freshness");
CREATE UNIQUE INDEX "ResearchOpportunity_researchHistoryId_key_key" ON "ResearchOpportunity"("researchHistoryId", "key");
CREATE INDEX "ResearchOpportunity_researchHistoryId_rank_idx" ON "ResearchOpportunity"("researchHistoryId", "rank");
CREATE INDEX "ResearchOpportunity_state_confidence_createdAt_idx" ON "ResearchOpportunity"("state", "confidence", "createdAt");
CREATE INDEX "ResearchOpportunity_subjectType_subject_idx" ON "ResearchOpportunity"("subjectType", "subject");
