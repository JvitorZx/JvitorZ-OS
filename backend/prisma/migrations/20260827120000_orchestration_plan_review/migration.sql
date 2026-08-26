-- CreateTable
CREATE TABLE "PlanReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "reviewer" TEXT,
    "reviewedAt" DATETIME,
    "decision" TEXT,
    "reason" TEXT,
    "riskLevel" TEXT NOT NULL,
    "sideEffectLevel" TEXT NOT NULL,
    "requiredApprovals" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "planHash" TEXT NOT NULL,
    "approvedPlanHash" TEXT,
    "approvedPlan" JSONB,
    "validUntil" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlanReview_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "OrchestrationExecution" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrchestrationAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actor" TEXT,
    "reason" TEXT,
    "details" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrchestrationAuditEvent_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "OrchestrationExecution" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PlanReview_executionId_key" ON "PlanReview"("executionId");
CREATE INDEX "PlanReview_state_createdAt_idx" ON "PlanReview"("state", "createdAt");
CREATE INDEX "PlanReview_riskLevel_createdAt_idx" ON "PlanReview"("riskLevel", "createdAt");
CREATE INDEX "OrchestrationAuditEvent_executionId_createdAt_idx" ON "OrchestrationAuditEvent"("executionId", "createdAt");
CREATE INDEX "OrchestrationAuditEvent_eventType_createdAt_idx" ON "OrchestrationAuditEvent"("eventType", "createdAt");
