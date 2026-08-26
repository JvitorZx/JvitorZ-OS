-- CreateTable
CREATE TABLE "OrchestrationExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "conversationId" TEXT,
    "idempotencyKey" TEXT,
    "intent" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "capabilities" JSONB NOT NULL,
    "request" JSONB NOT NULL,
    "plan" JSONB NOT NULL,
    "result" JSONB,
    "evidence" JSONB,
    "failures" JSONB NOT NULL,
    "errorType" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrchestrationExecution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OrchestrationExecution_idempotencyKey_key" ON "OrchestrationExecution"("idempotencyKey");
CREATE INDEX "OrchestrationExecution_projectId_createdAt_idx" ON "OrchestrationExecution"("projectId", "createdAt");
CREATE INDEX "OrchestrationExecution_conversationId_createdAt_idx" ON "OrchestrationExecution"("conversationId", "createdAt");
CREATE INDEX "OrchestrationExecution_status_createdAt_idx" ON "OrchestrationExecution"("status", "createdAt");
