CREATE TABLE "ContentPackaging" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "contentKey" TEXT NOT NULL,
    "videoId" TEXT,
    "game" TEXT,
    "series" TEXT,
    "episode" INTEGER,
    "format" TEXT,
    "summary" TEXT NOT NULL,
    "keyEvents" JSONB NOT NULL DEFAULT '[]',
    "editorialObjective" TEXT,
    "constraints" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "contextSnapshot" JSONB NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContentPackaging_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PackagingVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packagingId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "angle" TEXT NOT NULL,
    "sourceEvent" TEXT NOT NULL,
    "thumbnailBrief" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "rationale" TEXT NOT NULL,
    "seriesFit" REAL NOT NULL DEFAULT 0,
    "clickbaitRisk" TEXT NOT NULL DEFAULT 'LOW',
    "internalScore" REAL NOT NULL,
    "contextUsed" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "manualEdits" JSONB NOT NULL DEFAULT '{}',
    "selectedAt" DATETIME,
    "publishedAt" DATETIME,
    "publishedVideoId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PackagingVariant_packagingId_fkey" FOREIGN KEY ("packagingId") REFERENCES "ContentPackaging" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PackagingHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packagingId" TEXT NOT NULL,
    "variantId" TEXT,
    "event" TEXT NOT NULL,
    "reason" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PackagingHistory_packagingId_fkey" FOREIGN KEY ("packagingId") REFERENCES "ContentPackaging" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PackagingMetricSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "variantId" TEXT NOT NULL,
    "performanceSnapshotId" TEXT,
    "ingestionKey" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "periodStart" DATETIME,
    "periodEnd" DATETIME,
    "metrics" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PackagingMetricSnapshot_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PackagingVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PackagingMetricSnapshot_performanceSnapshotId_fkey" FOREIGN KEY ("performanceSnapshotId") REFERENCES "VideoPerformanceSnapshot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PackagingExperiment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packagingId" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "variantIds" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "contextEntryId" TEXT,
    "outcome" TEXT,
    "confidence" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PackagingExperiment_packagingId_fkey" FOREIGN KEY ("packagingId") REFERENCES "ContentPackaging" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ContentPackaging_contentKey_key" ON "ContentPackaging"("contentKey");
CREATE INDEX "ContentPackaging_projectId_updatedAt_idx" ON "ContentPackaging"("projectId", "updatedAt");
CREATE INDEX "ContentPackaging_videoId_idx" ON "ContentPackaging"("videoId");
CREATE INDEX "ContentPackaging_game_series_format_idx" ON "ContentPackaging"("game", "series", "format");
CREATE UNIQUE INDEX "PackagingVariant_packagingId_key_key" ON "PackagingVariant"("packagingId", "key");
CREATE INDEX "PackagingVariant_packagingId_status_idx" ON "PackagingVariant"("packagingId", "status");
CREATE INDEX "PackagingVariant_publishedVideoId_idx" ON "PackagingVariant"("publishedVideoId");
CREATE INDEX "PackagingHistory_packagingId_createdAt_idx" ON "PackagingHistory"("packagingId", "createdAt");
CREATE INDEX "PackagingHistory_variantId_createdAt_idx" ON "PackagingHistory"("variantId", "createdAt");
CREATE UNIQUE INDEX "PackagingMetricSnapshot_ingestionKey_key" ON "PackagingMetricSnapshot"("ingestionKey");
CREATE INDEX "PackagingMetricSnapshot_variantId_createdAt_idx" ON "PackagingMetricSnapshot"("variantId", "createdAt");
CREATE INDEX "PackagingMetricSnapshot_videoId_periodEnd_idx" ON "PackagingMetricSnapshot"("videoId", "periodEnd");
CREATE INDEX "PackagingMetricSnapshot_performanceSnapshotId_idx" ON "PackagingMetricSnapshot"("performanceSnapshotId");
CREATE INDEX "PackagingExperiment_packagingId_status_idx" ON "PackagingExperiment"("packagingId", "status");
CREATE INDEX "PackagingExperiment_contextEntryId_idx" ON "PackagingExperiment"("contextEntryId");
