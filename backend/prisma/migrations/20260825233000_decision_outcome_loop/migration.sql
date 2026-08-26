-- AlterTable
ALTER TABLE "VideoPerformanceSnapshot" ADD COLUMN "engagedViews" REAL;

-- CreateTable
CREATE TABLE "EditorialDecisionVideoLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "decisionId" TEXT NOT NULL,
    "sourceSnapshotId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "notes" TEXT,
    "linkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EditorialDecisionVideoLink_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "EditorialDecision" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EditorialDecisionVideoLink_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "VideoPerformanceSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EditorialDecisionOutcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "decisionVideoLinkId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "learningInsightId" TEXT,
    "windowStart" DATETIME,
    "windowEnd" DATETIME,
    "baseline" JSONB NOT NULL,
    "facts" JSONB NOT NULL,
    "comparison" JSONB NOT NULL,
    "interpretation" JSONB NOT NULL,
    "confidence" REAL NOT NULL,
    "classification" TEXT NOT NULL,
    "supportingMetrics" JSONB NOT NULL,
    "contradictingMetrics" JSONB NOT NULL,
    "missingData" JSONB NOT NULL,
    "hypotheses" JSONB NOT NULL,
    "evaluatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EditorialDecisionOutcome_decisionVideoLinkId_fkey" FOREIGN KEY ("decisionVideoLinkId") REFERENCES "EditorialDecisionVideoLink" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EditorialDecisionOutcome_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "VideoPerformanceSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EditorialDecisionOutcome_learningInsightId_fkey" FOREIGN KEY ("learningInsightId") REFERENCES "ChannelInsight" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "EditorialDecisionVideoLink_decisionId_videoId_key" ON "EditorialDecisionVideoLink"("decisionId", "videoId");
CREATE INDEX "EditorialDecisionVideoLink_decisionId_linkedAt_idx" ON "EditorialDecisionVideoLink"("decisionId", "linkedAt");
CREATE INDEX "EditorialDecisionVideoLink_videoId_idx" ON "EditorialDecisionVideoLink"("videoId");
CREATE INDEX "EditorialDecisionVideoLink_sourceSnapshotId_idx" ON "EditorialDecisionVideoLink"("sourceSnapshotId");
CREATE UNIQUE INDEX "EditorialDecisionOutcome_learningInsightId_key" ON "EditorialDecisionOutcome"("learningInsightId");
CREATE UNIQUE INDEX "EditorialDecisionOutcome_decisionVideoLinkId_snapshotId_key" ON "EditorialDecisionOutcome"("decisionVideoLinkId", "snapshotId");
CREATE INDEX "EditorialDecisionOutcome_snapshotId_idx" ON "EditorialDecisionOutcome"("snapshotId");
CREATE INDEX "EditorialDecisionOutcome_classification_evaluatedAt_idx" ON "EditorialDecisionOutcome"("classification", "evaluatedAt");
