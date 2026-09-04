CREATE TABLE "TimedTranscript" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productionId" TEXT,
    "libraryItemId" TEXT,
    "videoId" TEXT,
    "source" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "language" TEXT,
    "durationMs" INTEGER,
    "fingerprint" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TimedTranscript_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "ContentProduction" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TimedTranscript_libraryItemId_fkey" FOREIGN KEY ("libraryItemId") REFERENCES "LibraryItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "TimedTranscriptSegment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transcriptId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "sourceSegmentId" TEXT,
    "confidence" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TimedTranscriptSegment_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "TimedTranscript" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ChapterSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productionId" TEXT,
    "transcriptId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "generation" TEXT NOT NULL DEFAULT 'DETERMINISTIC',
    "selectedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChapterSet_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "ContentProduction" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChapterSet_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "TimedTranscript" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ChapterEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterSetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "segmentStartPosition" INTEGER NOT NULL,
    "segmentEndPosition" INTEGER NOT NULL,
    "confidence" REAL,
    "manuallyEdited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChapterEntry_chapterSetId_fkey" FOREIGN KEY ("chapterSetId") REFERENCES "ChapterSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ChapterRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterSetId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChapterRevision_chapterSetId_fkey" FOREIGN KEY ("chapterSetId") REFERENCES "ChapterSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TimedTranscript_fingerprint_key" ON "TimedTranscript"("fingerprint");
CREATE INDEX "TimedTranscript_productionId_createdAt_idx" ON "TimedTranscript"("productionId", "createdAt");
CREATE INDEX "TimedTranscript_videoId_createdAt_idx" ON "TimedTranscript"("videoId", "createdAt");
CREATE INDEX "TimedTranscript_libraryItemId_idx" ON "TimedTranscript"("libraryItemId");
CREATE UNIQUE INDEX "TimedTranscriptSegment_transcriptId_position_key" ON "TimedTranscriptSegment"("transcriptId", "position");
CREATE INDEX "TimedTranscriptSegment_transcriptId_startMs_idx" ON "TimedTranscriptSegment"("transcriptId", "startMs");
CREATE UNIQUE INDEX "ChapterSet_productionId_version_key" ON "ChapterSet"("productionId", "version");
CREATE INDEX "ChapterSet_productionId_status_createdAt_idx" ON "ChapterSet"("productionId", "status", "createdAt");
CREATE INDEX "ChapterSet_transcriptId_createdAt_idx" ON "ChapterSet"("transcriptId", "createdAt");
CREATE UNIQUE INDEX "ChapterEntry_chapterSetId_position_key" ON "ChapterEntry"("chapterSetId", "position");
CREATE INDEX "ChapterEntry_chapterSetId_startMs_idx" ON "ChapterEntry"("chapterSetId", "startMs");
CREATE INDEX "ChapterRevision_chapterSetId_createdAt_idx" ON "ChapterRevision"("chapterSetId", "createdAt");

UPDATE "ProductionStep"
SET "mode" = 'ASSISTED', "capability" = 'chapters'
WHERE "key" = 'CHAPTERS';
