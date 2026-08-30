CREATE TABLE "MonitoringRule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "signalType" TEXT NOT NULL,
  "defaultSeverity" TEXT NOT NULL,
  "cooldownHours" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "StrategicSignal" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT,
  "logicalKey" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'NEW',
  "source" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "impact" TEXT NOT NULL,
  "confidence" REAL NOT NULL,
  "limitations" JSONB NOT NULL DEFAULT '[]',
  "detectedAt" DATETIME NOT NULL,
  "lastObservedAt" DATETIME NOT NULL,
  "cooldownUntil" DATETIME NOT NULL,
  "acknowledgedAt" DATETIME,
  "resolvedAt" DATETIME,
  "dismissedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "StrategicSignal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "MonitoringSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT,
  "evaluationFingerprint" TEXT NOT NULL,
  "evaluatedSources" JSONB NOT NULL,
  "sourceState" JSONB NOT NULL,
  "candidateCount" INTEGER NOT NULL,
  "createdCount" INTEGER NOT NULL,
  "updatedCount" INTEGER NOT NULL,
  "resolvedCount" INTEGER NOT NULL,
  "evaluatedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonitoringSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "SignalEvidence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "signalId" TEXT NOT NULL,
  "snapshotId" TEXT,
  "source" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "observedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SignalEvidence_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "StrategicSignal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SignalEvidence_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MonitoringSnapshot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MonitoringRule_code_key" ON "MonitoringRule"("code");
CREATE INDEX "MonitoringRule_enabled_signalType_idx" ON "MonitoringRule"("enabled", "signalType");
CREATE UNIQUE INDEX "StrategicSignal_logicalKey_key" ON "StrategicSignal"("logicalKey");
CREATE INDEX "StrategicSignal_projectId_state_severity_detectedAt_idx" ON "StrategicSignal"("projectId", "state", "severity", "detectedAt");
CREATE INDEX "StrategicSignal_type_state_lastObservedAt_idx" ON "StrategicSignal"("type", "state", "lastObservedAt");
CREATE INDEX "StrategicSignal_source_sourceId_idx" ON "StrategicSignal"("source", "sourceId");
CREATE INDEX "StrategicSignal_fingerprint_idx" ON "StrategicSignal"("fingerprint");
CREATE UNIQUE INDEX "MonitoringSnapshot_evaluationFingerprint_key" ON "MonitoringSnapshot"("evaluationFingerprint");
CREATE INDEX "MonitoringSnapshot_projectId_evaluatedAt_idx" ON "MonitoringSnapshot"("projectId", "evaluatedAt");
CREATE UNIQUE INDEX "SignalEvidence_signalId_snapshotId_kind_key" ON "SignalEvidence"("signalId", "snapshotId", "kind");
CREATE INDEX "SignalEvidence_signalId_observedAt_idx" ON "SignalEvidence"("signalId", "observedAt");
CREATE INDEX "SignalEvidence_snapshotId_idx" ON "SignalEvidence"("snapshotId");
CREATE INDEX "SignalEvidence_source_sourceId_idx" ON "SignalEvidence"("source", "sourceId");
