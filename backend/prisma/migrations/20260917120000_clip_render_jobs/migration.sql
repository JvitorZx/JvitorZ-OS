CREATE TABLE "ClipRenderJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "candidateId" TEXT NOT NULL,
  "productionId" TEXT NOT NULL,
  "analysisId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "snapshotKey" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "layout" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "outputLibraryItemId" TEXT,
  "outputMetadata" JSONB,
  "outputFingerprint" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" DATETIME,
  "completedAt" DATETIME,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ClipRenderJob_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ClipCandidate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ClipRenderJob_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LocalMediaSource" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ClipRenderJob_outputLibraryItemId_fkey" FOREIGN KEY ("outputLibraryItemId") REFERENCES "LibraryItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ClipRenderJob_snapshotKey_attempt_key" ON "ClipRenderJob"("snapshotKey", "attempt");
CREATE INDEX "ClipRenderJob_productionId_createdAt_idx" ON "ClipRenderJob"("productionId", "createdAt");
CREATE INDEX "ClipRenderJob_status_createdAt_idx" ON "ClipRenderJob"("status", "createdAt");
