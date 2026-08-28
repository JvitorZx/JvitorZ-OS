CREATE TABLE "AudienceSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "ingestionKey" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "format" TEXT,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "views" REAL,
    "engagedViews" REAL,
    "watchTimeMinutes" REAL,
    "averageViewDurationSeconds" REAL,
    "averageViewPercentage" REAL,
    "source" TEXT NOT NULL,
    "collectedAt" DATETIME NOT NULL,
    "freshnessAtCollection" TEXT NOT NULL,
    "qualityAtCollection" TEXT NOT NULL,
    "qualityReasons" JSONB NOT NULL,
    "providerMetadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AudienceSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AudienceSyncState" (
    "source" TEXT NOT NULL PRIMARY KEY,
    "state" TEXT NOT NULL,
    "lastSyncAt" DATETIME,
    "lastErrorType" TEXT,
    "missingData" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "AudienceSnapshot_ingestionKey_key" ON "AudienceSnapshot"("ingestionKey");
CREATE INDEX "AudienceSnapshot_projectId_dimension_periodStart_periodEnd_idx" ON "AudienceSnapshot"("projectId", "dimension", "periodStart", "periodEnd");
CREATE INDEX "AudienceSnapshot_dimension_segment_format_idx" ON "AudienceSnapshot"("dimension", "segment", "format");
CREATE INDEX "AudienceSnapshot_source_collectedAt_idx" ON "AudienceSnapshot"("source", "collectedAt");
