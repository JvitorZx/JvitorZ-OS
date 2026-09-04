CREATE TABLE "ChannelContextEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT,
  "stableKey" TEXT NOT NULL,
  "channelId" TEXT,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "category" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "statement" TEXT NOT NULL,
  "confidence" REAL NOT NULL DEFAULT 1,
  "source" TEXT NOT NULL,
  "sourceReference" TEXT,
  "occurredAt" DATETIME,
  "periodStart" DATETIME,
  "periodEnd" DATETIME,
  "entityType" TEXT,
  "entityId" TEXT,
  "game" TEXT,
  "series" TEXT,
  "format" TEXT,
  "metadata" JSONB,
  "supersedesId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ChannelContextEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ChannelContextEntry_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "ChannelContextEntry" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ChannelContextRelation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "contextId" TEXT NOT NULL,
  "relation" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChannelContextRelation_contextId_fkey" FOREIGN KEY ("contextId") REFERENCES "ChannelContextEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ChannelContextEntry_stableKey_key" ON "ChannelContextEntry"("stableKey");
CREATE UNIQUE INDEX "ChannelContextEntry_supersedesId_key" ON "ChannelContextEntry"("supersedesId");
CREATE INDEX "ChannelContextEntry_projectId_type_status_idx" ON "ChannelContextEntry"("projectId", "type", "status");
CREATE INDEX "ChannelContextEntry_channelId_occurredAt_idx" ON "ChannelContextEntry"("channelId", "occurredAt");
CREATE INDEX "ChannelContextEntry_category_subject_idx" ON "ChannelContextEntry"("category", "subject");
CREATE INDEX "ChannelContextEntry_entityType_entityId_idx" ON "ChannelContextEntry"("entityType", "entityId");
CREATE INDEX "ChannelContextEntry_game_series_format_idx" ON "ChannelContextEntry"("game", "series", "format");
CREATE UNIQUE INDEX "ChannelContextRelation_contextId_relation_entityType_entityId_key" ON "ChannelContextRelation"("contextId", "relation", "entityType", "entityId");
CREATE INDEX "ChannelContextRelation_entityType_entityId_idx" ON "ChannelContextRelation"("entityType", "entityId");
CREATE INDEX "ChannelContextRelation_contextId_createdAt_idx" ON "ChannelContextRelation"("contextId", "createdAt");
