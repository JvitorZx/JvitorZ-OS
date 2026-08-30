CREATE TABLE "StrategicLearning" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "key" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "comparisonContext" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "observationCount" INTEGER NOT NULL,
    "favorableCount" INTEGER NOT NULL,
    "neutralCount" INTEGER NOT NULL,
    "contraryCount" INTEGER NOT NULL,
    "confidence" REAL NOT NULL,
    "freshness" TEXT NOT NULL,
    "benchmark" JSONB NOT NULL,
    "limitations" JSONB NOT NULL,
    "analysisFingerprint" TEXT NOT NULL,
    "firstObservedAt" DATETIME NOT NULL,
    "lastObservedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StrategicLearning_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "StrategicLearningEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "learningId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "stance" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StrategicLearningEvidence_learningId_fkey" FOREIGN KEY ("learningId") REFERENCES "StrategicLearning" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StrategicLearningEvidence_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "PlanningOutcome" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "StrategicLearningRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "learningId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "previousStatus" TEXT,
    "currentStatus" TEXT NOT NULL,
    "previousConfidence" REAL,
    "currentConfidence" REAL NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StrategicLearningRevision_learningId_fkey" FOREIGN KEY ("learningId") REFERENCES "StrategicLearning" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "StrategicLearning_key_key" ON "StrategicLearning"("key");
CREATE INDEX "StrategicLearning_projectId_status_confidence_idx" ON "StrategicLearning"("projectId", "status", "confidence");
CREATE INDEX "StrategicLearning_dimension_subject_idx" ON "StrategicLearning"("dimension", "subject");
CREATE INDEX "StrategicLearning_freshness_updatedAt_idx" ON "StrategicLearning"("freshness", "updatedAt");
CREATE UNIQUE INDEX "StrategicLearningEvidence_learningId_outcomeId_key" ON "StrategicLearningEvidence"("learningId", "outcomeId");
CREATE INDEX "StrategicLearningEvidence_outcomeId_idx" ON "StrategicLearningEvidence"("outcomeId");
CREATE INDEX "StrategicLearningEvidence_learningId_stance_idx" ON "StrategicLearningEvidence"("learningId", "stance");
CREATE INDEX "StrategicLearningRevision_learningId_createdAt_idx" ON "StrategicLearningRevision"("learningId", "createdAt");
CREATE INDEX "StrategicLearningRevision_event_createdAt_idx" ON "StrategicLearningRevision"("event", "createdAt");
