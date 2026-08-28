CREATE TABLE "VideoReachSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "ingestionKey" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "impressions" REAL NOT NULL,
    "ctr" REAL NOT NULL,
    "source" TEXT NOT NULL,
    "reportId" TEXT,
    "jobId" TEXT,
    "reportCreatedAt" DATETIME,
    "collectedAt" DATETIME NOT NULL,
    "freshnessAtCollection" TEXT NOT NULL,
    "qualityAtCollection" TEXT NOT NULL,
    "qualityReasons" JSONB NOT NULL,
    "providerMetadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VideoReachSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ReachSyncState" (
    "source" TEXT NOT NULL PRIMARY KEY,
    "reportTypeId" TEXT NOT NULL,
    "jobId" TEXT,
    "state" TEXT NOT NULL,
    "lastReportAt" DATETIME,
    "lastSyncAt" DATETIME,
    "lastErrorType" TEXT,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "VideoReachSnapshot_ingestionKey_key" ON "VideoReachSnapshot"("ingestionKey");
CREATE INDEX "VideoReachSnapshot_projectId_collectedAt_idx" ON "VideoReachSnapshot"("projectId", "collectedAt");
CREATE INDEX "VideoReachSnapshot_videoId_periodStart_periodEnd_source_idx" ON "VideoReachSnapshot"("videoId", "periodStart", "periodEnd", "source");
CREATE INDEX "VideoReachSnapshot_source_collectedAt_idx" ON "VideoReachSnapshot"("source", "collectedAt");
