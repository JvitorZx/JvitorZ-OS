CREATE TABLE "MonitoringControl" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'strategic-monitoring',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "intervalMs" INTEGER NOT NULL DEFAULT 21600000,
  "operationalState" TEXT NOT NULL DEFAULT 'DISABLED',
  "lastRunAt" DATETIME,
  "lastSuccessfulRunAt" DATETIME,
  "lastFailureAt" DATETIME,
  "lastErrorType" TEXT,
  "nextRunAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "MonitoringControl_enabled_nextRunAt_idx" ON "MonitoringControl"("enabled", "nextRunAt");

INSERT INTO "MonitoringControl" (
  "id", "enabled", "intervalMs", "operationalState", "createdAt", "updatedAt"
) VALUES (
  'strategic-monitoring', false, 21600000, 'DISABLED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);
