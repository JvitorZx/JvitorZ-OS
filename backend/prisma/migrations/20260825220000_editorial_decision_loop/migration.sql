-- CreateTable
CREATE TABLE "EditorialDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "conversationId" TEXT,
    "operatorMessageId" TEXT,
    "outcomeSnapshotId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "alternatives" JSONB NOT NULL,
    "score" REAL,
    "confidence" REAL NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'recommendation',
    "evidence" JSONB NOT NULL,
    "risks" JSONB NOT NULL,
    "missingData" JSONB NOT NULL,
    "nextAction" TEXT NOT NULL,
    "outcome" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EditorialDecision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EditorialDecision_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EditorialDecision_operatorMessageId_fkey" FOREIGN KEY ("operatorMessageId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EditorialDecision_outcomeSnapshotId_fkey" FOREIGN KEY ("outcomeSnapshotId") REFERENCES "VideoPerformanceSnapshot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "EditorialDecision_operatorMessageId_key" ON "EditorialDecision"("operatorMessageId");
CREATE UNIQUE INDEX "EditorialDecision_dedupeKey_key" ON "EditorialDecision"("dedupeKey");
CREATE INDEX "EditorialDecision_projectId_createdAt_idx" ON "EditorialDecision"("projectId", "createdAt");
CREATE INDEX "EditorialDecision_conversationId_createdAt_idx" ON "EditorialDecision"("conversationId", "createdAt");
CREATE INDEX "EditorialDecision_outcomeSnapshotId_idx" ON "EditorialDecision"("outcomeSnapshotId");
