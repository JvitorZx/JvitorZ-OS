-- CreateTable
CREATE TABLE "ContentPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "horizon" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "balance" JSONB NOT NULL,
    "constraints" JSONB NOT NULL,
    "risks" JSONB NOT NULL,
    "source" JSONB NOT NULL,
    "generatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContentPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlannedContentItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "sourceDecisionId" TEXT,
    "sourceResearchOpportunityId" TEXT,
    "researchHistoryId" TEXT,
    "seriesId" TEXT,
    "candidateKey" TEXT NOT NULL,
    "candidateType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "effort" TEXT NOT NULL,
    "readiness" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "executionScore" REAL NOT NULL,
    "manualPriority" BOOLEAN NOT NULL DEFAULT false,
    "evidence" JSONB NOT NULL,
    "risks" JSONB NOT NULL,
    "constraints" JSONB NOT NULL,
    "missingData" JSONB NOT NULL,
    "dependencies" JSONB NOT NULL,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlannedContentItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlannedContentItem_sourceDecisionId_fkey" FOREIGN KEY ("sourceDecisionId") REFERENCES "EditorialDecision" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlannedContentItem_sourceResearchOpportunityId_fkey" FOREIGN KEY ("sourceResearchOpportunityId") REFERENCES "ResearchOpportunity" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlannedContentItem_researchHistoryId_fkey" FOREIGN KEY ("researchHistoryId") REFERENCES "ResearchHistory" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlannedContentItem_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "SeriesDefinition" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlanningHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "itemId" TEXT,
    "event" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanningHistory_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlanningHistory_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PlannedContentItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ContentPlan_projectId_generatedAt_idx" ON "ContentPlan"("projectId", "generatedAt");
CREATE INDEX "ContentPlan_status_horizon_generatedAt_idx" ON "ContentPlan"("status", "horizon", "generatedAt");
CREATE UNIQUE INDEX "PlannedContentItem_planId_candidateKey_key" ON "PlannedContentItem"("planId", "candidateKey");
CREATE INDEX "PlannedContentItem_planId_position_idx" ON "PlannedContentItem"("planId", "position");
CREATE INDEX "PlannedContentItem_status_priority_readiness_idx" ON "PlannedContentItem"("status", "priority", "readiness");
CREATE INDEX "PlannedContentItem_sourceDecisionId_idx" ON "PlannedContentItem"("sourceDecisionId");
CREATE INDEX "PlannedContentItem_sourceResearchOpportunityId_idx" ON "PlannedContentItem"("sourceResearchOpportunityId");
CREATE INDEX "PlanningHistory_planId_createdAt_idx" ON "PlanningHistory"("planId", "createdAt");
CREATE INDEX "PlanningHistory_itemId_createdAt_idx" ON "PlanningHistory"("itemId", "createdAt");
CREATE INDEX "PlanningHistory_event_createdAt_idx" ON "PlanningHistory"("event", "createdAt");
