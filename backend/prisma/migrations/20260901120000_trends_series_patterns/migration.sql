-- Additive temporal and editorial intelligence tables. Existing performance data is unchanged.
CREATE TABLE "TrendSignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "currentWindow" JSONB NOT NULL,
    "previousWindow" JSONB NOT NULL,
    "delta" REAL,
    "sampleSize" INTEGER NOT NULL,
    "confidence" REAL NOT NULL,
    "evidence" JSONB NOT NULL,
    "quality" JSONB NOT NULL,
    "detectedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrendSignal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "SeriesDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "game" TEXT,
    "topic" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SeriesDefinition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "VideoSeriesLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seriesId" TEXT NOT NULL,
    "sourceSnapshotId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "evidence" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VideoSeriesLink_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "SeriesDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VideoSeriesLink_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "VideoPerformanceSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ContentPattern" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "patternType" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "game" TEXT,
    "topic" TEXT,
    "format" TEXT,
    "series" TEXT,
    "summary" TEXT NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "confidence" REAL NOT NULL,
    "evidence" JSONB NOT NULL,
    "quality" JSONB NOT NULL,
    "detectedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContentPattern_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TrendSignal_key_key" ON "TrendSignal"("key");
CREATE INDEX "TrendSignal_projectId_subjectType_detectedAt_idx" ON "TrendSignal"("projectId", "subjectType", "detectedAt");
CREATE INDEX "TrendSignal_classification_detectedAt_idx" ON "TrendSignal"("classification", "detectedAt");
CREATE UNIQUE INDEX "SeriesDefinition_key_key" ON "SeriesDefinition"("key");
CREATE INDEX "SeriesDefinition_projectId_normalizedKey_idx" ON "SeriesDefinition"("projectId", "normalizedKey");
CREATE INDEX "SeriesDefinition_status_updatedAt_idx" ON "SeriesDefinition"("status", "updatedAt");
CREATE UNIQUE INDEX "VideoSeriesLink_seriesId_videoId_key" ON "VideoSeriesLink"("seriesId", "videoId");
CREATE INDEX "VideoSeriesLink_videoId_idx" ON "VideoSeriesLink"("videoId");
CREATE INDEX "VideoSeriesLink_sourceSnapshotId_idx" ON "VideoSeriesLink"("sourceSnapshotId");
CREATE UNIQUE INDEX "ContentPattern_key_key" ON "ContentPattern"("key");
CREATE INDEX "ContentPattern_projectId_patternType_detectedAt_idx" ON "ContentPattern"("projectId", "patternType", "detectedAt");
CREATE INDEX "ContentPattern_classification_detectedAt_idx" ON "ContentPattern"("classification", "detectedAt");
