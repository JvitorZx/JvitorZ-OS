-- Creator Intelligence is additive: existing Planner and Library data remain untouched.
CREATE TABLE "VideoIdea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "game" TEXT,
    "theme" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "premise" TEXT NOT NULL,
    "estimatedEffort" INTEGER,
    "novelty" REAL,
    "identityFit" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VideoIdea_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ContentOpportunity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoIdeaId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "score" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentOpportunity_videoIdeaId_fkey" FOREIGN KEY ("videoIdeaId") REFERENCES "VideoIdea" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ContentDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoIdeaId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentDecision_videoIdeaId_fkey" FOREIGN KEY ("videoIdeaId") REFERENCES "VideoIdea" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ChannelInsight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "classification" TEXT NOT NULL,
    "evidence" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChannelInsight_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PerformanceSignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "videoIdeaId" TEXT,
    "game" TEXT,
    "format" TEXT,
    "metric" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "sampleSize" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'real',
    "measuredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PerformanceSignal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PerformanceSignal_videoIdeaId_fkey" FOREIGN KEY ("videoIdeaId") REFERENCES "VideoIdea" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "VideoIdea_projectId_createdAt_idx" ON "VideoIdea"("projectId", "createdAt");
CREATE INDEX "ContentOpportunity_videoIdeaId_createdAt_idx" ON "ContentOpportunity"("videoIdeaId", "createdAt");
CREATE INDEX "ContentDecision_videoIdeaId_createdAt_idx" ON "ContentDecision"("videoIdeaId", "createdAt");
CREATE UNIQUE INDEX "ChannelInsight_key_key" ON "ChannelInsight"("key");
CREATE INDEX "ChannelInsight_projectId_category_idx" ON "ChannelInsight"("projectId", "category");
CREATE INDEX "PerformanceSignal_projectId_game_idx" ON "PerformanceSignal"("projectId", "game");
CREATE INDEX "PerformanceSignal_projectId_format_idx" ON "PerformanceSignal"("projectId", "format");
CREATE INDEX "PerformanceSignal_videoIdeaId_idx" ON "PerformanceSignal"("videoIdeaId");
