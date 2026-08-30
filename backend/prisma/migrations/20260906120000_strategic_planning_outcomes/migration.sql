CREATE TABLE "PlanningOutcomeLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "planId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "executionEventId" TEXT NOT NULL,
    "sourceSnapshotId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "videoTitle" TEXT NOT NULL,
    "publishedAt" DATETIME,
    "activeItemKey" TEXT,
    "activeVideoKey" TEXT,
    "linkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlinkedAt" DATETIME,
    "unlinkReason" TEXT,
    CONSTRAINT "PlanningOutcomeLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlanningOutcomeLink_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlanningOutcomeLink_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PlannedContentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlanningOutcomeLink_executionEventId_fkey" FOREIGN KEY ("executionEventId") REFERENCES "PlanningExecutionEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PlanningOutcomeLink_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "VideoPerformanceSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PlanningOutcomeLink_activeItemKey_key" ON "PlanningOutcomeLink"("activeItemKey");
CREATE UNIQUE INDEX "PlanningOutcomeLink_activeVideoKey_key" ON "PlanningOutcomeLink"("activeVideoKey");
CREATE INDEX "PlanningOutcomeLink_planId_linkedAt_idx" ON "PlanningOutcomeLink"("planId", "linkedAt");
CREATE INDEX "PlanningOutcomeLink_itemId_linkedAt_idx" ON "PlanningOutcomeLink"("itemId", "linkedAt");
CREATE INDEX "PlanningOutcomeLink_videoId_linkedAt_idx" ON "PlanningOutcomeLink"("videoId", "linkedAt");
CREATE INDEX "PlanningOutcomeLink_executionEventId_idx" ON "PlanningOutcomeLink"("executionEventId");
CREATE INDEX "PlanningOutcomeLink_sourceSnapshotId_idx" ON "PlanningOutcomeLink"("sourceSnapshotId");

CREATE TABLE "PlanningOutcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "planId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "executionEventId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL,
    "windowStart" DATETIME,
    "windowEnd" DATETIME,
    "freshness" TEXT NOT NULL,
    "dataQuality" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "benchmark" JSONB NOT NULL,
    "comparison" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "classification" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "limitations" JSONB NOT NULL,
    "missingData" JSONB NOT NULL,
    "evaluatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlanningOutcome_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlanningOutcome_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlanningOutcome_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PlannedContentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlanningOutcome_executionEventId_fkey" FOREIGN KEY ("executionEventId") REFERENCES "PlanningExecutionEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PlanningOutcome_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "PlanningOutcomeLink" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlanningOutcome_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "VideoPerformanceSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PlanningOutcome_linkId_snapshotId_key" ON "PlanningOutcome"("linkId", "snapshotId");
CREATE INDEX "PlanningOutcome_planId_evaluatedAt_idx" ON "PlanningOutcome"("planId", "evaluatedAt");
CREATE INDEX "PlanningOutcome_itemId_evaluatedAt_idx" ON "PlanningOutcome"("itemId", "evaluatedAt");
CREATE INDEX "PlanningOutcome_videoId_observedAt_idx" ON "PlanningOutcome"("videoId", "observedAt");
CREATE INDEX "PlanningOutcome_snapshotId_idx" ON "PlanningOutcome"("snapshotId");
CREATE INDEX "PlanningOutcome_classification_evaluatedAt_idx" ON "PlanningOutcome"("classification", "evaluatedAt");

CREATE TABLE "PlanningOutcomeAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "linkId" TEXT,
    "outcomeId" TEXT,
    "event" TEXT NOT NULL,
    "reason" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanningOutcomeAuditEvent_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlanningOutcomeAuditEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PlannedContentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlanningOutcomeAuditEvent_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "PlanningOutcomeLink" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlanningOutcomeAuditEvent_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "PlanningOutcome" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "PlanningOutcomeAuditEvent_planId_createdAt_idx" ON "PlanningOutcomeAuditEvent"("planId", "createdAt");
CREATE INDEX "PlanningOutcomeAuditEvent_itemId_createdAt_idx" ON "PlanningOutcomeAuditEvent"("itemId", "createdAt");
CREATE INDEX "PlanningOutcomeAuditEvent_linkId_createdAt_idx" ON "PlanningOutcomeAuditEvent"("linkId", "createdAt");
CREATE INDEX "PlanningOutcomeAuditEvent_outcomeId_createdAt_idx" ON "PlanningOutcomeAuditEvent"("outcomeId", "createdAt");
CREATE INDEX "PlanningOutcomeAuditEvent_event_createdAt_idx" ON "PlanningOutcomeAuditEvent"("event", "createdAt");
