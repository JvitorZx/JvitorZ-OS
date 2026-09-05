CREATE TABLE "ShortAnalysis" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productionId" TEXT NOT NULL,
  "transcriptId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CURRENT',
  "sourceFingerprint" TEXT NOT NULL,
  "configuration" JSONB NOT NULL,
  "context" JSONB NOT NULL,
  "limitations" JSONB NOT NULL,
  "review" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ShortAnalysis_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "ContentProduction" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ShortAnalysis_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "TimedTranscript" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ShortAnalysis_productionId_version_key" ON "ShortAnalysis"("productionId", "version");
CREATE INDEX "ShortAnalysis_productionId_status_idx" ON "ShortAnalysis"("productionId", "status");
CREATE INDEX "ShortAnalysis_transcriptId_idx" ON "ShortAnalysis"("transcriptId");
CREATE UNIQUE INDEX "ShortAnalysis_one_current" ON "ShortAnalysis"("productionId") WHERE "status" = 'CURRENT';
CREATE TABLE "ClipCandidate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "analysisId" TEXT NOT NULL,
  "momentKey" TEXT NOT NULL,
  "variantOfId" TEXT,
  "variantReason" TEXT,
  "startMs" INTEGER NOT NULL,
  "endMs" INTEGER NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "hook" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "chapterEntryId" TEXT,
  "game" TEXT,
  "series" TEXT,
  "format" TEXT NOT NULL DEFAULT 'SHORT',
  "score" REAL NOT NULL,
  "scoreFactors" JSONB NOT NULL,
  "risks" JSONB NOT NULL,
  "evidence" JSONB NOT NULL,
  "review" JSONB,
  "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
  "manuallyEdited" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ClipCandidate_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ShortAnalysis" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClipCandidate_valid_range" CHECK ("startMs" >= 0 AND "endMs" > "startMs" AND "durationMs" = "endMs" - "startMs")
);
CREATE INDEX "ClipCandidate_analysisId_status_score_idx" ON "ClipCandidate"("analysisId", "status", "score");
CREATE INDEX "ClipCandidate_analysisId_momentKey_idx" ON "ClipCandidate"("analysisId", "momentKey");
CREATE TABLE "ClipRevision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "analysisId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "candidateId" TEXT,
  "snapshot" JSONB NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClipRevision_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ShortAnalysis" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ClipRevision_analysisId_createdAt_idx" ON "ClipRevision"("analysisId", "createdAt");
UPDATE "ProductionStep" SET "mode" = 'ASSISTED', "capability" = 'shorts' WHERE "key" = 'SHORTS';
