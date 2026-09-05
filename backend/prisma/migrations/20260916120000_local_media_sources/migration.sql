CREATE TABLE "LocalMediaSource" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "libraryItemId" TEXT NOT NULL,
  "rootId" TEXT NOT NULL,
  "relativePath" TEXT NOT NULL,
  "identityKey" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "sizeBytes" TEXT NOT NULL,
  "durationMs" INTEGER,
  "formatName" TEXT,
  "videoCodec" TEXT,
  "audioCodec" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "hasAudio" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
  "errorCode" TEXT,
  "probeAt" DATETIME,
  "lastCheckedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "LocalMediaSource_libraryItemId_fkey" FOREIGN KEY ("libraryItemId") REFERENCES "LibraryItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LocalMediaSource_libraryItemId_key" ON "LocalMediaSource"("libraryItemId");
CREATE UNIQUE INDEX "LocalMediaSource_identityKey_key" ON "LocalMediaSource"("identityKey");
CREATE INDEX "LocalMediaSource_status_updatedAt_idx" ON "LocalMediaSource"("status", "updatedAt");
CREATE INDEX "LocalMediaSource_rootId_idx" ON "LocalMediaSource"("rootId");
