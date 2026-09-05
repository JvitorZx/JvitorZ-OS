-- Sprint 49: additive Research Sessions, auditable evidence and structured ideas.

ALTER TABLE "VideoIdea" ADD COLUMN "workingTitle" TEXT;
ALTER TABLE "VideoIdea" ADD COLUMN "series" TEXT;
ALTER TABLE "VideoIdea" ADD COLUMN "coreEvent" TEXT;
ALTER TABLE "VideoIdea" ADD COLUMN "viewerPromise" TEXT;
ALTER TABLE "VideoIdea" ADD COLUMN "whyNow" TEXT;
ALTER TABLE "VideoIdea" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'CANDIDATE';
ALTER TABLE "VideoIdea" ADD COLUMN "effortLevel" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "VideoIdea" ADD COLUMN "risks" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "VideoIdea" ADD COLUMN "assumptions" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "VideoIdea" ADD COLUMN "hypothesis" TEXT;
ALTER TABLE "VideoIdea" ADD COLUMN "strategicFit" REAL;
ALTER TABLE "VideoIdea" ADD COLUMN "opportunityScore" REAL;
ALTER TABLE "VideoIdea" ADD COLUMN "scoreDetails" JSONB;
ALTER TABLE "VideoIdea" ADD COLUMN "sourceResearchHistoryId" TEXT REFERENCES "ResearchHistory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoIdea" ADD COLUMN "sourceOpportunityId" TEXT REFERENCES "ResearchOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoIdea" ADD COLUMN "ideaKey" TEXT;
ALTER TABLE "VideoIdea" ADD COLUMN "duplicateOfId" TEXT REFERENCES "VideoIdea"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoIdea" ADD COLUMN "isExperiment" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "VideoIdea" ADD COLUMN "selectedAt" DATETIME;
ALTER TABLE "VideoIdea" ADD COLUMN "rejectedAt" DATETIME;
ALTER TABLE "VideoIdea" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "VideoIdea" ADD COLUMN "rejectionReason" TEXT;

ALTER TABLE "ResearchHistory" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE "ResearchHistory" ADD COLUMN "objective" TEXT;
ALTER TABLE "ResearchHistory" ADD COLUMN "format" TEXT;
ALTER TABLE "ResearchHistory" ADD COLUMN "game" TEXT;
ALTER TABLE "ResearchHistory" ADD COLUMN "constraints" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "ResearchHistory" ADD COLUMN "runVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ResearchHistory" ADD COLUMN "startedAt" DATETIME;
ALTER TABLE "ResearchHistory" ADD COLUMN "completedAt" DATETIME;
ALTER TABLE "ResearchHistory" ADD COLUMN "archivedAt" DATETIME;

ALTER TABLE "ResearchOpportunity" ADD COLUMN "candidateStatus" TEXT NOT NULL DEFAULT 'CANDIDATE';
ALTER TABLE "ResearchOpportunity" ADD COLUMN "effort" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "ResearchOpportunity" ADD COLUMN "novelty" REAL;
ALTER TABLE "ResearchOpportunity" ADD COLUMN "saturation" REAL;
ALTER TABLE "ResearchOpportunity" ADD COLUMN "qualityGate" TEXT NOT NULL DEFAULT 'INSUFFICIENT_EVIDENCE';
ALTER TABLE "ResearchOpportunity" ADD COLUMN "scoreDetails" JSONB;

CREATE TABLE "ResearchEvidenceItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "researchHistoryId" TEXT NOT NULL,
  "evidenceKey" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "sourceName" TEXT NOT NULL,
  "classification" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "metricName" TEXT,
  "metricValue" REAL,
  "unit" TEXT,
  "reference" TEXT,
  "observedAt" DATETIME,
  "retrievedAt" DATETIME NOT NULL,
  "freshness" TEXT NOT NULL,
  "confidence" REAL,
  "provenance" JSONB,
  "context" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResearchEvidenceItem_researchHistoryId_fkey" FOREIGN KEY ("researchHistoryId") REFERENCES "ResearchHistory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ResearchSessionEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "researchHistoryId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "reason" TEXT,
  "data" JSONB,
  "occurredAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResearchSessionEvent_researchHistoryId_fkey" FOREIGN KEY ("researchHistoryId") REFERENCES "ResearchHistory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ResearchContentGap" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "researchHistoryId" TEXT NOT NULL,
  "gapKey" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "relevance" REAL NOT NULL,
  "risk" TEXT,
  "freshness" TEXT NOT NULL,
  "game" TEXT,
  "series" TEXT,
  "possibleAction" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ResearchContentGap_researchHistoryId_fkey" FOREIGN KEY ("researchHistoryId") REFERENCES "ResearchHistory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "VideoIdea_ideaKey_key" ON "VideoIdea"("ideaKey");
CREATE INDEX "VideoIdea_projectId_status_updatedAt_idx" ON "VideoIdea"("projectId", "status", "updatedAt");
CREATE INDEX "VideoIdea_sourceResearchHistoryId_idx" ON "VideoIdea"("sourceResearchHistoryId");
CREATE INDEX "VideoIdea_sourceOpportunityId_idx" ON "VideoIdea"("sourceOpportunityId");
CREATE INDEX "ResearchHistory_status_updatedAt_idx" ON "ResearchHistory"("status", "updatedAt");
CREATE UNIQUE INDEX "ResearchEvidenceItem_researchHistoryId_evidenceKey_key" ON "ResearchEvidenceItem"("researchHistoryId", "evidenceKey");
CREATE INDEX "ResearchEvidenceItem_researchHistoryId_sourceType_idx" ON "ResearchEvidenceItem"("researchHistoryId", "sourceType");
CREATE INDEX "ResearchEvidenceItem_sourceType_sourceId_idx" ON "ResearchEvidenceItem"("sourceType", "sourceId");
CREATE INDEX "ResearchSessionEvent_researchHistoryId_occurredAt_idx" ON "ResearchSessionEvent"("researchHistoryId", "occurredAt");
CREATE INDEX "ResearchSessionEvent_event_occurredAt_idx" ON "ResearchSessionEvent"("event", "occurredAt");
CREATE UNIQUE INDEX "ResearchContentGap_researchHistoryId_gapKey_key" ON "ResearchContentGap"("researchHistoryId", "gapKey");
CREATE INDEX "ResearchContentGap_researchHistoryId_relevance_idx" ON "ResearchContentGap"("researchHistoryId", "relevance");
