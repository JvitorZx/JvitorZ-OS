CREATE TABLE "VideoPerformanceSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "ingestionKey" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "game" TEXT,
    "series" TEXT,
    "format" TEXT,
    "publishedAt" DATETIME,
    "periodStart" DATETIME,
    "periodEnd" DATETIME,
    "views" REAL,
    "impressions" REAL,
    "ctr" REAL,
    "durationSeconds" REAL,
    "averageViewDurationSeconds" REAL,
    "averageViewPercentage" REAL,
    "watchTimeMinutes" REAL,
    "subscribersGained" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "source" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 1,
    "collectedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VideoPerformanceSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "VideoPerformanceSnapshot_ingestionKey_key" ON "VideoPerformanceSnapshot"("ingestionKey");
CREATE INDEX "VideoPerformanceSnapshot_projectId_collectedAt_idx" ON "VideoPerformanceSnapshot"("projectId", "collectedAt");
CREATE INDEX "VideoPerformanceSnapshot_videoId_source_idx" ON "VideoPerformanceSnapshot"("videoId", "source");
CREATE INDEX "VideoPerformanceSnapshot_game_idx" ON "VideoPerformanceSnapshot"("game");
CREATE INDEX "VideoPerformanceSnapshot_series_idx" ON "VideoPerformanceSnapshot"("series");
CREATE INDEX "VideoPerformanceSnapshot_format_idx" ON "VideoPerformanceSnapshot"("format");

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_PerformanceSignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "videoIdeaId" TEXT,
    "performanceSnapshotId" TEXT,
    "key" TEXT,
    "game" TEXT,
    "series" TEXT,
    "format" TEXT,
    "metric" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "sampleSize" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'real',
    "confidence" REAL NOT NULL DEFAULT 1,
    "measuredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PerformanceSignal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PerformanceSignal_videoIdeaId_fkey" FOREIGN KEY ("videoIdeaId") REFERENCES "VideoIdea" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PerformanceSignal_performanceSnapshotId_fkey" FOREIGN KEY ("performanceSnapshotId") REFERENCES "VideoPerformanceSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_PerformanceSignal" (
    "id", "projectId", "videoIdeaId", "game", "series", "format", "metric", "value",
    "sampleSize", "source", "classification", "confidence", "measuredAt", "createdAt"
)
SELECT
    "id", "projectId", "videoIdeaId", "game", NULL, "format", "metric", "value",
    "sampleSize", "source", "classification", 1, "measuredAt", "createdAt"
FROM "PerformanceSignal";

DROP TABLE "PerformanceSignal";
ALTER TABLE "new_PerformanceSignal" RENAME TO "PerformanceSignal";

CREATE UNIQUE INDEX "PerformanceSignal_key_key" ON "PerformanceSignal"("key");
CREATE INDEX "PerformanceSignal_projectId_game_idx" ON "PerformanceSignal"("projectId", "game");
CREATE INDEX "PerformanceSignal_projectId_format_idx" ON "PerformanceSignal"("projectId", "format");
CREATE INDEX "PerformanceSignal_projectId_series_idx" ON "PerformanceSignal"("projectId", "series");
CREATE INDEX "PerformanceSignal_videoIdeaId_idx" ON "PerformanceSignal"("videoIdeaId");
CREATE INDEX "PerformanceSignal_performanceSnapshotId_idx" ON "PerformanceSignal"("performanceSnapshotId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
