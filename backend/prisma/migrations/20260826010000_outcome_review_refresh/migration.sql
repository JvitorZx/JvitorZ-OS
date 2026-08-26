-- DropIndex
DROP INDEX "EditorialDecisionOutcome_learningInsightId_key";

-- CreateIndex
CREATE INDEX "EditorialDecisionOutcome_learningInsightId_idx" ON "EditorialDecisionOutcome"("learningInsightId");

-- CreateTable
CREATE TABLE "EditorialDecisionOutcomeReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceOutcomeId" TEXT NOT NULL,
    "resultOutcomeId" TEXT,
    "previousSnapshotId" TEXT NOT NULL,
    "currentSnapshotId" TEXT NOT NULL,
    "reviewKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL,
    "previousClassification" TEXT NOT NULL,
    "currentClassification" TEXT,
    "previousConfidence" REAL NOT NULL,
    "currentConfidence" REAL,
    "changedMetrics" JSONB NOT NULL,
    "previousState" JSONB NOT NULL,
    "currentState" JSONB,
    "errorType" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "EditorialDecisionOutcomeReview_sourceOutcomeId_fkey" FOREIGN KEY ("sourceOutcomeId") REFERENCES "EditorialDecisionOutcome" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EditorialDecisionOutcomeReview_resultOutcomeId_fkey" FOREIGN KEY ("resultOutcomeId") REFERENCES "EditorialDecisionOutcome" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EditorialDecisionOutcomeReview_previousSnapshotId_fkey" FOREIGN KEY ("previousSnapshotId") REFERENCES "VideoPerformanceSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EditorialDecisionOutcomeReview_currentSnapshotId_fkey" FOREIGN KEY ("currentSnapshotId") REFERENCES "VideoPerformanceSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "EditorialDecisionOutcomeReview_reviewKey_key" ON "EditorialDecisionOutcomeReview"("reviewKey");
CREATE INDEX "EditorialDecisionOutcomeReview_sourceOutcomeId_startedAt_idx" ON "EditorialDecisionOutcomeReview"("sourceOutcomeId", "startedAt");
CREATE INDEX "EditorialDecisionOutcomeReview_status_startedAt_idx" ON "EditorialDecisionOutcomeReview"("status", "startedAt");
CREATE INDEX "EditorialDecisionOutcomeReview_currentSnapshotId_idx" ON "EditorialDecisionOutcomeReview"("currentSnapshotId");
