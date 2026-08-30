CREATE TABLE "StrategicExperiment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT,
  "sourceLearningId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "context" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "primaryMetric" TEXT NOT NULL,
  "secondaryMetrics" JSONB NOT NULL DEFAULT '[]',
  "risk" TEXT,
  "comparisonCriterion" JSONB NOT NULL DEFAULT '{}',
  "confidence" REAL NOT NULL DEFAULT 0,
  "limitations" JSONB NOT NULL DEFAULT '[]',
  "startedAt" DATETIME,
  "endedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "StrategicExperiment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "StrategicExperiment_sourceLearningId_fkey" FOREIGN KEY ("sourceLearningId") REFERENCES "StrategicLearning" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ExperimentHypothesis" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "experimentId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "priorEvidence" JSONB NOT NULL DEFAULT '[]',
  "expectedVariantKey" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ExperimentHypothesis_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "StrategicExperiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ExperimentVariant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "experimentId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "plannedItemId" TEXT,
  "executionEventId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ExperimentVariant_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "StrategicExperiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExperimentVariant_plannedItemId_fkey" FOREIGN KEY ("plannedItemId") REFERENCES "PlannedContentItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ExperimentVariant_executionEventId_fkey" FOREIGN KEY ("executionEventId") REFERENCES "PlanningExecutionEvent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ExperimentMetric" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "experimentId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExperimentMetric_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "StrategicExperiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ExperimentConstraint" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "experimentId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "blocking" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExperimentConstraint_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "StrategicExperiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ExperimentObservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "experimentId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "outcomeId" TEXT NOT NULL,
  "observedAt" DATETIME NOT NULL,
  "freshness" TEXT NOT NULL,
  "dataQuality" TEXT NOT NULL,
  "comparisonContext" JSONB NOT NULL,
  "metrics" JSONB NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExperimentObservation_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "StrategicExperiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExperimentObservation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ExperimentVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExperimentObservation_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "PlanningOutcome" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ExperimentResult" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "experimentId" TEXT NOT NULL,
  "classification" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "confidence" REAL NOT NULL,
  "benchmark" JSONB NOT NULL,
  "limitations" JSONB NOT NULL,
  "analysisFingerprint" TEXT NOT NULL,
  "analyzedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ExperimentResult_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "StrategicExperiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ExperimentEvidence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "experimentId" TEXT NOT NULL,
  "resultId" TEXT,
  "observationId" TEXT,
  "learningId" TEXT,
  "stance" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExperimentEvidence_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "StrategicExperiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExperimentEvidence_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "ExperimentResult" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ExperimentEvidence_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "ExperimentObservation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ExperimentEvidence_learningId_fkey" FOREIGN KEY ("learningId") REFERENCES "StrategicLearning" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ExperimentEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "experimentId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "reason" TEXT,
  "data" JSONB NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExperimentEvent_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "StrategicExperiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ExperimentHypothesis_experimentId_key" ON "ExperimentHypothesis"("experimentId");
CREATE UNIQUE INDEX "ExperimentVariant_experimentId_key_key" ON "ExperimentVariant"("experimentId", "key");
CREATE UNIQUE INDEX "ExperimentMetric_experimentId_name_key" ON "ExperimentMetric"("experimentId", "name");
CREATE UNIQUE INDEX "ExperimentConstraint_experimentId_code_key" ON "ExperimentConstraint"("experimentId", "code");
CREATE UNIQUE INDEX "ExperimentObservation_experimentId_outcomeId_key" ON "ExperimentObservation"("experimentId", "outcomeId");
CREATE UNIQUE INDEX "ExperimentResult_experimentId_key" ON "ExperimentResult"("experimentId");
CREATE UNIQUE INDEX "ExperimentEvidence_experimentId_observationId_key" ON "ExperimentEvidence"("experimentId", "observationId");
CREATE INDEX "StrategicExperiment_projectId_status_updatedAt_idx" ON "StrategicExperiment"("projectId", "status", "updatedAt");
CREATE INDEX "StrategicExperiment_sourceLearningId_idx" ON "StrategicExperiment"("sourceLearningId");
CREATE INDEX "ExperimentVariant_plannedItemId_idx" ON "ExperimentVariant"("plannedItemId");
CREATE INDEX "ExperimentVariant_executionEventId_idx" ON "ExperimentVariant"("executionEventId");
CREATE INDEX "ExperimentObservation_variantId_observedAt_idx" ON "ExperimentObservation"("variantId", "observedAt");
CREATE INDEX "ExperimentObservation_outcomeId_idx" ON "ExperimentObservation"("outcomeId");
CREATE INDEX "ExperimentEvidence_resultId_idx" ON "ExperimentEvidence"("resultId");
CREATE INDEX "ExperimentEvidence_learningId_idx" ON "ExperimentEvidence"("learningId");
CREATE INDEX "ExperimentEvent_experimentId_createdAt_idx" ON "ExperimentEvent"("experimentId", "createdAt");
CREATE INDEX "ExperimentEvent_event_createdAt_idx" ON "ExperimentEvent"("event", "createdAt");
