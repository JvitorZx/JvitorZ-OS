ALTER TABLE "AutomationRun" ADD COLUMN "sourceRunId" TEXT;

CREATE INDEX "AutomationRun_sourceRunId_idx" ON "AutomationRun"("sourceRunId");

CREATE TABLE "AutomationGovernancePolicy" (
  "automationId" TEXT NOT NULL PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "maxRunsPerDay" INTEGER,
  "maxRunsPerWeek" INTEGER,
  "cooldownMinutes" INTEGER,
  "allowedExecutionWindows" JSONB,
  "maxConsecutiveFailures" INTEGER,
  "pauseOnRepeatedFailure" BOOLEAN NOT NULL DEFAULT true,
  "manualApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
  "retryPolicy" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AutomationGovernancePolicy_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AutomationGovernancePolicy_enabled_updatedAt_idx" ON "AutomationGovernancePolicy"("enabled", "updatedAt");
