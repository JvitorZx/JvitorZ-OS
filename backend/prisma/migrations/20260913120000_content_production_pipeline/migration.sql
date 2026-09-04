CREATE TABLE "ContentProduction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "productionKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "game" TEXT,
    "series" TEXT,
    "episode" INTEGER,
    "origin" TEXT NOT NULL,
    "objective" TEXT,
    "summary" TEXT,
    "keyEvents" JSONB NOT NULL DEFAULT '[]',
    "owner" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "plannedAt" DATETIME,
    "publishedAt" DATETIME,
    "publishedVideoId" TEXT,
    "publishedUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "currentStage" TEXT NOT NULL DEFAULT 'PLANNED',
    "workflowTemplate" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "videoIdeaId" TEXT,
    "plannedContentItemId" TEXT,
    "seriesId" TEXT,
    "packagingId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContentProduction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ContentProduction_videoIdeaId_fkey" FOREIGN KEY ("videoIdeaId") REFERENCES "VideoIdea" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ContentProduction_plannedContentItemId_fkey" FOREIGN KEY ("plannedContentItemId") REFERENCES "PlannedContentItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ContentProduction_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "SeriesDefinition" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ContentProduction_packagingId_fkey" FOREIGN KEY ("packagingId") REFERENCES "ContentPackaging" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ProductionStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "capability" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "skippable" BOOLEAN NOT NULL DEFAULT false,
    "dependencies" JSONB NOT NULL DEFAULT '[]',
    "state" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "executionKey" TEXT,
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "skipReason" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "invalidatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductionStep_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "ContentProduction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ProductionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productionId" TEXT NOT NULL,
    "stepKey" TEXT,
    "event" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT,
    "reason" TEXT,
    "operationKey" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductionEvent_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "ContentProduction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ProductionAssetRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productionId" TEXT NOT NULL,
    "libraryItemId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductionAssetRelation_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "ContentProduction" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductionAssetRelation_libraryItemId_fkey" FOREIGN KEY ("libraryItemId") REFERENCES "LibraryItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ContentProduction_productionKey_key" ON "ContentProduction"("productionKey");
CREATE UNIQUE INDEX "ContentProduction_plannedContentItemId_key" ON "ContentProduction"("plannedContentItemId");
CREATE UNIQUE INDEX "ContentProduction_packagingId_key" ON "ContentProduction"("packagingId");
CREATE INDEX "ContentProduction_projectId_status_updatedAt_idx" ON "ContentProduction"("projectId", "status", "updatedAt");
CREATE INDEX "ContentProduction_format_currentStage_updatedAt_idx" ON "ContentProduction"("format", "currentStage", "updatedAt");
CREATE INDEX "ContentProduction_publishedVideoId_idx" ON "ContentProduction"("publishedVideoId");
CREATE INDEX "ContentProduction_videoIdeaId_idx" ON "ContentProduction"("videoIdeaId");
CREATE INDEX "ContentProduction_seriesId_idx" ON "ContentProduction"("seriesId");
CREATE UNIQUE INDEX "ProductionStep_productionId_key_key" ON "ProductionStep"("productionId", "key");
CREATE UNIQUE INDEX "ProductionStep_productionId_key_executionKey_key" ON "ProductionStep"("productionId", "key", "executionKey");
CREATE INDEX "ProductionStep_productionId_position_idx" ON "ProductionStep"("productionId", "position");
CREATE INDEX "ProductionStep_state_updatedAt_idx" ON "ProductionStep"("state", "updatedAt");
CREATE UNIQUE INDEX "ProductionEvent_operationKey_key" ON "ProductionEvent"("operationKey");
CREATE INDEX "ProductionEvent_productionId_createdAt_idx" ON "ProductionEvent"("productionId", "createdAt");
CREATE INDEX "ProductionEvent_productionId_stepKey_createdAt_idx" ON "ProductionEvent"("productionId", "stepKey", "createdAt");
CREATE INDEX "ProductionEvent_event_createdAt_idx" ON "ProductionEvent"("event", "createdAt");
CREATE UNIQUE INDEX "ProductionAssetRelation_productionId_libraryItemId_role_key" ON "ProductionAssetRelation"("productionId", "libraryItemId", "role");
CREATE INDEX "ProductionAssetRelation_productionId_createdAt_idx" ON "ProductionAssetRelation"("productionId", "createdAt");
CREATE INDEX "ProductionAssetRelation_libraryItemId_idx" ON "ProductionAssetRelation"("libraryItemId");
