ALTER TABLE "Automation" ADD COLUMN "triggerType" TEXT NOT NULL DEFAULT 'MANUAL_ONLY';
ALTER TABLE "Automation" ADD COLUMN "schedule" JSONB;
ALTER TABLE "Automation" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE "Automation" ADD COLUMN "intent" TEXT;
ALTER TABLE "Automation" ADD COLUMN "orchestrationInput" JSONB;
ALTER TABLE "Automation" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'DISABLED';
ALTER TABLE "Automation" ADD COLUMN "riskLevel" TEXT;
ALTER TABLE "Automation" ADD COLUMN "sideEffectLevel" TEXT;
ALTER TABLE "Automation" ADD COLUMN "nextRunAt" DATETIME;
ALTER TABLE "Automation" ADD COLUMN "lastRunAt" DATETIME;

CREATE TABLE "AutomationRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "automationId" TEXT NOT NULL,
  "occurrenceKey" TEXT NOT NULL,
  "triggerSource" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "scheduledFor" DATETIME,
  "orchestrationExecutionId" TEXT,
  "resultSummary" TEXT,
  "failureReason" TEXT,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "startedAt" DATETIME,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AutomationRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AutomationAuditEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "automationId" TEXT NOT NULL,
  "runId" TEXT,
  "eventType" TEXT NOT NULL,
  "reason" TEXT,
  "details" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationAuditEvent_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Automation_enabled_status_nextRunAt_idx" ON "Automation"("enabled", "status", "nextRunAt");
CREATE INDEX "Automation_projectId_createdAt_idx" ON "Automation"("projectId", "createdAt");
CREATE UNIQUE INDEX "AutomationRun_automationId_occurrenceKey_key" ON "AutomationRun"("automationId", "occurrenceKey");
CREATE UNIQUE INDEX "AutomationRun_one_active_per_automation" ON "AutomationRun"("automationId") WHERE "status" IN ('PENDING', 'RUNNING');
CREATE INDEX "AutomationRun_automationId_createdAt_idx" ON "AutomationRun"("automationId", "createdAt");
CREATE INDEX "AutomationRun_status_createdAt_idx" ON "AutomationRun"("status", "createdAt");
CREATE INDEX "AutomationRun_orchestrationExecutionId_idx" ON "AutomationRun"("orchestrationExecutionId");
CREATE INDEX "AutomationAuditEvent_automationId_createdAt_idx" ON "AutomationAuditEvent"("automationId", "createdAt");
CREATE INDEX "AutomationAuditEvent_runId_createdAt_idx" ON "AutomationAuditEvent"("runId", "createdAt");
CREATE INDEX "AutomationAuditEvent_eventType_createdAt_idx" ON "AutomationAuditEvent"("eventType", "createdAt");
