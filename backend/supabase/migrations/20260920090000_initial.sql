-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT,
    "context" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Operator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelSnapshot" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subscriberCount" TEXT,
    "videoCount" TEXT,
    "viewCount" TEXT,
    "country" TEXT,
    "publishedAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "sourceMessageId" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT,
    "content" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalMediaSource" (
    "id" TEXT NOT NULL,
    "libraryItemId" TEXT NOT NULL,
    "rootId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "sizeBytes" TEXT NOT NULL,
    "durationMs" INTEGER,
    "formatName" TEXT,
    "videoCodec" TEXT,
    "audioCodec" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "hasAudio" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
    "errorCode" TEXT,
    "probeAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalMediaSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationLibraryItem" (
    "conversationId" TEXT NOT NULL,
    "libraryItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationLibraryItem_pkey" PRIMARY KEY ("conversationId","libraryItemId")
);

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" TEXT,
    "action" TEXT,
    "triggerType" TEXT NOT NULL DEFAULT 'MANUAL_ONLY',
    "schedule" JSONB,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "intent" TEXT,
    "orchestrationInput" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DISABLED',
    "riskLevel" TEXT,
    "sideEffectLevel" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "triggerSource" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3),
    "orchestrationExecutionId" TEXT,
    "resultSummary" TEXT,
    "failureReason" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "sourceRunId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationGovernancePolicy" (
    "automationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "maxRunsPerDay" INTEGER,
    "maxRunsPerWeek" INTEGER,
    "cooldownMinutes" INTEGER,
    "allowedExecutionWindows" JSONB,
    "maxConsecutiveFailures" INTEGER,
    "pauseOnRepeatedFailure" BOOLEAN NOT NULL DEFAULT true,
    "manualApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
    "retryPolicy" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationGovernancePolicy_pkey" PRIMARY KEY ("automationId")
);

-- CreateTable
CREATE TABLE "AutomationAuditEvent" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "runId" TEXT,
    "eventType" TEXT NOT NULL,
    "reason" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRuntimeEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRuntimeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "metrics" JSONB NOT NULL,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoIdea" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "game" TEXT,
    "theme" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "premise" TEXT NOT NULL,
    "estimatedEffort" INTEGER,
    "novelty" DOUBLE PRECISION,
    "identityFit" DOUBLE PRECISION,
    "workingTitle" TEXT,
    "series" TEXT,
    "coreEvent" TEXT,
    "viewerPromise" TEXT,
    "whyNow" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "effortLevel" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "risks" JSONB NOT NULL DEFAULT '[]',
    "assumptions" JSONB NOT NULL DEFAULT '[]',
    "hypothesis" TEXT,
    "strategicFit" DOUBLE PRECISION,
    "opportunityScore" DOUBLE PRECISION,
    "scoreDetails" JSONB,
    "sourceResearchHistoryId" TEXT,
    "sourceOpportunityId" TEXT,
    "ideaKey" TEXT,
    "duplicateOfId" TEXT,
    "isExperiment" BOOLEAN NOT NULL DEFAULT false,
    "selectedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoIdea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentOpportunity" (
    "id" TEXT NOT NULL,
    "videoIdeaId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentDecision" (
    "id" TEXT NOT NULL,
    "videoIdeaId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelInsight" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "classification" TEXT NOT NULL,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelContextEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "stableKey" TEXT NOT NULL,
    "channelId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL,
    "sourceReference" TEXT,
    "occurredAt" TIMESTAMP(3),
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "entityType" TEXT,
    "entityId" TEXT,
    "game" TEXT,
    "series" TEXT,
    "format" TEXT,
    "metadata" JSONB,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelContextEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelContextRelation" (
    "id" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelContextRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceSignal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "videoIdeaId" TEXT,
    "performanceSnapshotId" TEXT,
    "key" TEXT,
    "game" TEXT,
    "series" TEXT,
    "format" TEXT,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "sampleSize" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'real',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoPerformanceSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "ingestionKey" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "game" TEXT,
    "series" TEXT,
    "format" TEXT,
    "publishedAt" TIMESTAMP(3),
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "views" DOUBLE PRECISION,
    "engagedViews" DOUBLE PRECISION,
    "impressions" DOUBLE PRECISION,
    "ctr" DOUBLE PRECISION,
    "durationSeconds" DOUBLE PRECISION,
    "averageViewDurationSeconds" DOUBLE PRECISION,
    "averageViewPercentage" DOUBLE PRECISION,
    "watchTimeMinutes" DOUBLE PRECISION,
    "subscribersGained" INTEGER,
    "subscribersLost" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoPerformanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPackaging" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "contentKey" TEXT NOT NULL,
    "videoId" TEXT,
    "game" TEXT,
    "series" TEXT,
    "episode" INTEGER,
    "format" TEXT,
    "summary" TEXT NOT NULL,
    "keyEvents" JSONB NOT NULL DEFAULT '[]',
    "editorialObjective" TEXT,
    "constraints" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "contextSnapshot" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPackaging_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagingVariant" (
    "id" TEXT NOT NULL,
    "packagingId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "angle" TEXT NOT NULL,
    "sourceEvent" TEXT NOT NULL,
    "thumbnailBrief" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "rationale" TEXT NOT NULL,
    "seriesFit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clickbaitRisk" TEXT NOT NULL DEFAULT 'LOW',
    "internalScore" DOUBLE PRECISION NOT NULL,
    "contextUsed" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "manualEdits" JSONB NOT NULL DEFAULT '{}',
    "selectedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "publishedVideoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackagingVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagingHistory" (
    "id" TEXT NOT NULL,
    "packagingId" TEXT NOT NULL,
    "variantId" TEXT,
    "event" TEXT NOT NULL,
    "reason" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackagingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagingMetricSnapshot" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "performanceSnapshotId" TEXT,
    "ingestionKey" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "metrics" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackagingMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagingExperiment" (
    "id" TEXT NOT NULL,
    "packagingId" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "variantIds" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "contextEntryId" TEXT,
    "outcome" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackagingExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendSignal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "currentWindow" JSONB NOT NULL,
    "previousWindow" JSONB NOT NULL,
    "delta" DOUBLE PRECISION,
    "sampleSize" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL,
    "quality" JSONB NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrendSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeriesDefinition" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "game" TEXT,
    "topic" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeriesDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoSeriesLink" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "sourceSnapshotId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoSeriesLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPattern" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "patternType" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "game" TEXT,
    "topic" TEXT,
    "format" TEXT,
    "series" TEXT,
    "summary" TEXT NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL,
    "quality" JSONB NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchHistory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "executionKey" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "normalizedQuery" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "subjectType" TEXT,
    "subject" TEXT,
    "sources" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "quality" TEXT NOT NULL,
    "freshness" TEXT NOT NULL,
    "limitations" JSONB NOT NULL,
    "context" JSONB,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "objective" TEXT,
    "format" TEXT,
    "game" TEXT,
    "constraints" JSONB NOT NULL DEFAULT '[]',
    "runVersion" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "researchedAt" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchOpportunity" (
    "id" TEXT NOT NULL,
    "researchHistoryId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sources" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "freshness" TEXT NOT NULL,
    "compatibility" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "risks" JSONB NOT NULL,
    "gaps" JSONB NOT NULL,
    "nextInvestigation" TEXT NOT NULL,
    "candidateStatus" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "effort" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "novelty" DOUBLE PRECISION,
    "saturation" DOUBLE PRECISION,
    "qualityGate" TEXT NOT NULL DEFAULT 'INSUFFICIENT_EVIDENCE',
    "scoreDetails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchEvidenceItem" (
    "id" TEXT NOT NULL,
    "researchHistoryId" TEXT NOT NULL,
    "evidenceKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceName" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metricName" TEXT,
    "metricValue" DOUBLE PRECISION,
    "unit" TEXT,
    "reference" TEXT,
    "observedAt" TIMESTAMP(3),
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "freshness" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "provenance" JSONB,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchEvidenceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchSessionEvent" (
    "id" TEXT NOT NULL,
    "researchHistoryId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "reason" TEXT,
    "data" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchSessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchContentGap" (
    "id" TEXT NOT NULL,
    "researchHistoryId" TEXT NOT NULL,
    "gapKey" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "relevance" DOUBLE PRECISION NOT NULL,
    "risk" TEXT,
    "freshness" TEXT NOT NULL,
    "game" TEXT,
    "series" TEXT,
    "possibleAction" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchContentGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPlan" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "horizon" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "balance" JSONB NOT NULL,
    "constraints" JSONB NOT NULL,
    "risks" JSONB NOT NULL,
    "source" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannedContentItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "sourceDecisionId" TEXT,
    "sourceResearchOpportunityId" TEXT,
    "researchHistoryId" TEXT,
    "seriesId" TEXT,
    "candidateKey" TEXT NOT NULL,
    "candidateType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "effort" TEXT NOT NULL,
    "readiness" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "executionScore" DOUBLE PRECISION NOT NULL,
    "manualPriority" BOOLEAN NOT NULL DEFAULT false,
    "evidence" JSONB NOT NULL,
    "risks" JSONB NOT NULL,
    "constraints" JSONB NOT NULL,
    "missingData" JSONB NOT NULL,
    "dependencies" JSONB NOT NULL,
    "executionState" TEXT NOT NULL DEFAULT 'pending',
    "executionAction" TEXT NOT NULL DEFAULT 'Revisar item e preparar a proxima acao.',
    "executionConfidence" DOUBLE PRECISION,
    "executionContext" JSONB NOT NULL DEFAULT '{}',
    "executionStartedAt" TIMESTAMP(3),
    "executionEndedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlannedContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentProduction" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "productionKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "game" TEXT,
    "series" TEXT,
    "episode" INTEGER,
    "origin" TEXT NOT NULL,
    "objective" TEXT,
    "summary" TEXT,
    "keyEvents" JSONB NOT NULL DEFAULT '[]',
    "owner" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "plannedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "publishedVideoId" TEXT,
    "publishedUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "currentStage" TEXT NOT NULL DEFAULT 'PLANNED',
    "workflowTemplate" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "videoIdeaId" TEXT,
    "plannedContentItemId" TEXT,
    "seriesId" TEXT,
    "packagingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentProduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimedTranscript" (
    "id" TEXT NOT NULL,
    "productionId" TEXT,
    "libraryItemId" TEXT,
    "videoId" TEXT,
    "source" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "language" TEXT,
    "durationMs" INTEGER,
    "fingerprint" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimedTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimedTranscriptSegment" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "sourceSegmentId" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimedTranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChapterSet" (
    "id" TEXT NOT NULL,
    "productionId" TEXT,
    "transcriptId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "generation" TEXT NOT NULL DEFAULT 'DETERMINISTIC',
    "selectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChapterSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChapterEntry" (
    "id" TEXT NOT NULL,
    "chapterSetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "segmentStartPosition" INTEGER NOT NULL,
    "segmentEndPosition" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION,
    "manuallyEdited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChapterEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortAnalysis" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CURRENT',
    "sourceFingerprint" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "context" JSONB NOT NULL,
    "limitations" JSONB NOT NULL,
    "review" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShortAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipCandidate" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "momentKey" TEXT NOT NULL,
    "variantOfId" TEXT,
    "variantReason" TEXT,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "chapterEntryId" TEXT,
    "game" TEXT,
    "series" TEXT,
    "format" TEXT NOT NULL DEFAULT 'SHORT',
    "score" DOUBLE PRECISION NOT NULL,
    "scoreFactors" JSONB NOT NULL,
    "risks" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "review" JSONB,
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "manuallyEdited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipRenderJob" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "snapshotKey" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "layout" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "outputLibraryItemId" TEXT,
    "outputMetadata" JSONB,
    "outputFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipRenderJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipRevision" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "candidateId" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChapterRevision" (
    "id" TEXT NOT NULL,
    "chapterSetId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChapterRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionStep" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "capability" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "skippable" BOOLEAN NOT NULL DEFAULT false,
    "dependencies" JSONB NOT NULL DEFAULT '[]',
    "state" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "executionKey" TEXT,
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "skipReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionEvent" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "stepKey" TEXT,
    "event" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT,
    "reason" TEXT,
    "operationKey" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionAssetRelation" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "libraryItemId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionAssetRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanningHistory" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "itemId" TEXT,
    "event" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanningHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanningExecutionEvent" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "itemTitle" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "confidence" DOUBLE PRECISION,
    "strategicContext" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanningExecutionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanningOutcomeLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "planId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "executionEventId" TEXT NOT NULL,
    "sourceSnapshotId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "videoTitle" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "activeItemKey" TEXT,
    "activeVideoKey" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlinkedAt" TIMESTAMP(3),
    "unlinkReason" TEXT,

    CONSTRAINT "PlanningOutcomeLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanningOutcome" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "planId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "executionEventId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "freshness" TEXT NOT NULL,
    "dataQuality" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "benchmark" JSONB NOT NULL,
    "comparison" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "classification" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "limitations" JSONB NOT NULL,
    "missingData" JSONB NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanningOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategicLearning" (
    "id" TEXT NOT NULL,
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
    "confidence" DOUBLE PRECISION NOT NULL,
    "freshness" TEXT NOT NULL,
    "benchmark" JSONB NOT NULL,
    "limitations" JSONB NOT NULL,
    "analysisFingerprint" TEXT NOT NULL,
    "firstObservedAt" TIMESTAMP(3) NOT NULL,
    "lastObservedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategicLearning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategicExperiment" (
    "id" TEXT NOT NULL,
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
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "limitations" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategicExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentHypothesis" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priorEvidence" JSONB NOT NULL DEFAULT '[]',
    "expectedVariantKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExperimentHypothesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentVariant" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "plannedItemId" TEXT,
    "executionEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExperimentVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentMetric" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentConstraint" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentConstraint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentObservation" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "freshness" TEXT NOT NULL,
    "dataQuality" TEXT NOT NULL,
    "comparisonContext" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentResult" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "benchmark" JSONB NOT NULL,
    "limitations" JSONB NOT NULL,
    "analysisFingerprint" TEXT NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExperimentResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentEvidence" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "resultId" TEXT,
    "observationId" TEXT,
    "learningId" TEXT,
    "stance" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentEvent" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "reason" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "defaultSeverity" TEXT NOT NULL,
    "cooldownHours" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringControl" (
    "id" TEXT NOT NULL DEFAULT 'strategic-monitoring',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "intervalMs" INTEGER NOT NULL DEFAULT 21600000,
    "operationalState" TEXT NOT NULL DEFAULT 'DISABLED',
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessfulRunAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastErrorType" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategicSignal" (
    "id" TEXT NOT NULL,
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
    "confidence" DOUBLE PRECISION NOT NULL,
    "limitations" JSONB NOT NULL DEFAULT '[]',
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "lastObservedAt" TIMESTAMP(3) NOT NULL,
    "cooldownUntil" TIMESTAMP(3) NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategicSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "evaluationFingerprint" TEXT NOT NULL,
    "evaluatedSources" JSONB NOT NULL,
    "sourceState" JSONB NOT NULL,
    "candidateCount" INTEGER NOT NULL,
    "createdCount" INTEGER NOT NULL,
    "updatedCount" INTEGER NOT NULL,
    "resolvedCount" INTEGER NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignalEvidence" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignalEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategicLearningEvidence" (
    "id" TEXT NOT NULL,
    "learningId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "stance" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategicLearningEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategicLearningRevision" (
    "id" TEXT NOT NULL,
    "learningId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "previousStatus" TEXT,
    "currentStatus" TEXT NOT NULL,
    "previousConfidence" DOUBLE PRECISION,
    "currentConfidence" DOUBLE PRECISION NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategicLearningRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanningOutcomeAuditEvent" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "linkId" TEXT,
    "outcomeId" TEXT,
    "event" TEXT NOT NULL,
    "reason" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanningOutcomeAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoReachSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "ingestionKey" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "impressions" DOUBLE PRECISION NOT NULL,
    "ctr" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "reportId" TEXT,
    "jobId" TEXT,
    "reportCreatedAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "freshnessAtCollection" TEXT NOT NULL,
    "qualityAtCollection" TEXT NOT NULL,
    "qualityReasons" JSONB NOT NULL,
    "providerMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoReachSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReachSyncState" (
    "source" TEXT NOT NULL,
    "reportTypeId" TEXT NOT NULL,
    "jobId" TEXT,
    "state" TEXT NOT NULL,
    "lastReportAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastErrorType" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReachSyncState_pkey" PRIMARY KEY ("source")
);

-- CreateTable
CREATE TABLE "AudienceSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "ingestionKey" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "format" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "views" DOUBLE PRECISION,
    "engagedViews" DOUBLE PRECISION,
    "watchTimeMinutes" DOUBLE PRECISION,
    "averageViewDurationSeconds" DOUBLE PRECISION,
    "averageViewPercentage" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "freshnessAtCollection" TEXT NOT NULL,
    "qualityAtCollection" TEXT NOT NULL,
    "qualityReasons" JSONB NOT NULL,
    "providerMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AudienceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudienceSyncState" (
    "source" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "lastErrorType" TEXT,
    "missingData" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AudienceSyncState_pkey" PRIMARY KEY ("source")
);

-- CreateTable
CREATE TABLE "EditorialDecision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "conversationId" TEXT,
    "operatorMessageId" TEXT,
    "outcomeSnapshotId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "alternatives" JSONB NOT NULL,
    "score" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'recommendation',
    "category" TEXT NOT NULL DEFAULT 'INSUFFICIENT_DATA',
    "candidateType" TEXT,
    "candidateKey" TEXT,
    "opportunityScore" JSONB,
    "favorableEvidence" JSONB NOT NULL DEFAULT '[]',
    "contraryEvidence" JSONB NOT NULL DEFAULT '[]',
    "constraints" JSONB NOT NULL DEFAULT '[]',
    "evidence" JSONB NOT NULL,
    "risks" JSONB NOT NULL,
    "missingData" JSONB NOT NULL,
    "nextAction" TEXT NOT NULL,
    "outcome" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditorialDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorialDecisionVideoLink" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "sourceSnapshotId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "notes" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditorialDecisionVideoLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorialDecisionOutcome" (
    "id" TEXT NOT NULL,
    "decisionVideoLinkId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "learningInsightId" TEXT,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "baseline" JSONB NOT NULL,
    "facts" JSONB NOT NULL,
    "comparison" JSONB NOT NULL,
    "interpretation" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "classification" TEXT NOT NULL,
    "supportingMetrics" JSONB NOT NULL,
    "contradictingMetrics" JSONB NOT NULL,
    "missingData" JSONB NOT NULL,
    "hypotheses" JSONB NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditorialDecisionOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorialDecisionOutcomeReview" (
    "id" TEXT NOT NULL,
    "sourceOutcomeId" TEXT NOT NULL,
    "resultOutcomeId" TEXT,
    "previousSnapshotId" TEXT NOT NULL,
    "currentSnapshotId" TEXT NOT NULL,
    "reviewKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL,
    "previousClassification" TEXT NOT NULL,
    "currentClassification" TEXT,
    "previousConfidence" DOUBLE PRECISION NOT NULL,
    "currentConfidence" DOUBLE PRECISION,
    "changedMetrics" JSONB NOT NULL,
    "previousState" JSONB NOT NULL,
    "currentState" JSONB,
    "errorType" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "EditorialDecisionOutcomeReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrchestrationExecution" (
    "id" TEXT NOT NULL,
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
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrchestrationExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanReview" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "reviewer" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decision" TEXT,
    "reason" TEXT,
    "riskLevel" TEXT NOT NULL,
    "sideEffectLevel" TEXT NOT NULL,
    "requiredApprovals" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "planHash" TEXT NOT NULL,
    "approvedPlanHash" TEXT,
    "approvedPlan" JSONB,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrchestrationAuditEvent" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actor" TEXT,
    "reason" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrchestrationAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelSnapshot_channelId_key" ON "ChannelSnapshot"("channelId");

-- CreateIndex
CREATE INDEX "ChannelSnapshot_collectedAt_idx" ON "ChannelSnapshot"("collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryItem_sourceMessageId_key" ON "LibraryItem"("sourceMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "LocalMediaSource_libraryItemId_key" ON "LocalMediaSource"("libraryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "LocalMediaSource_identityKey_key" ON "LocalMediaSource"("identityKey");

-- CreateIndex
CREATE INDEX "LocalMediaSource_status_updatedAt_idx" ON "LocalMediaSource"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "LocalMediaSource_rootId_idx" ON "LocalMediaSource"("rootId");

-- CreateIndex
CREATE INDEX "ConversationLibraryItem_conversationId_createdAt_libraryIte_idx" ON "ConversationLibraryItem"("conversationId", "createdAt", "libraryItemId");

-- CreateIndex
CREATE INDEX "ConversationLibraryItem_libraryItemId_idx" ON "ConversationLibraryItem"("libraryItemId");

-- CreateIndex
CREATE INDEX "Automation_enabled_status_nextRunAt_idx" ON "Automation"("enabled", "status", "nextRunAt");

-- CreateIndex
CREATE INDEX "Automation_projectId_createdAt_idx" ON "Automation"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationRun_automationId_createdAt_idx" ON "AutomationRun"("automationId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationRun_status_createdAt_idx" ON "AutomationRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationRun_orchestrationExecutionId_idx" ON "AutomationRun"("orchestrationExecutionId");

-- CreateIndex
CREATE INDEX "AutomationRun_sourceRunId_idx" ON "AutomationRun"("sourceRunId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRun_automationId_occurrenceKey_key" ON "AutomationRun"("automationId", "occurrenceKey");

-- CreateIndex
CREATE INDEX "AutomationGovernancePolicy_enabled_updatedAt_idx" ON "AutomationGovernancePolicy"("enabled", "updatedAt");

-- CreateIndex
CREATE INDEX "AutomationAuditEvent_automationId_createdAt_idx" ON "AutomationAuditEvent"("automationId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationAuditEvent_runId_createdAt_idx" ON "AutomationAuditEvent"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationAuditEvent_eventType_createdAt_idx" ON "AutomationAuditEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationRuntimeEvent_eventType_createdAt_idx" ON "AutomationRuntimeEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationRuntimeEvent_createdAt_idx" ON "AutomationRuntimeEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_key_key" ON "Setting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "VideoIdea_ideaKey_key" ON "VideoIdea"("ideaKey");

-- CreateIndex
CREATE INDEX "VideoIdea_projectId_createdAt_idx" ON "VideoIdea"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoIdea_projectId_status_updatedAt_idx" ON "VideoIdea"("projectId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "VideoIdea_sourceResearchHistoryId_idx" ON "VideoIdea"("sourceResearchHistoryId");

-- CreateIndex
CREATE INDEX "VideoIdea_sourceOpportunityId_idx" ON "VideoIdea"("sourceOpportunityId");

-- CreateIndex
CREATE INDEX "ContentOpportunity_videoIdeaId_createdAt_idx" ON "ContentOpportunity"("videoIdeaId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentDecision_videoIdeaId_createdAt_idx" ON "ContentDecision"("videoIdeaId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelInsight_key_key" ON "ChannelInsight"("key");

-- CreateIndex
CREATE INDEX "ChannelInsight_projectId_category_idx" ON "ChannelInsight"("projectId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelContextEntry_stableKey_key" ON "ChannelContextEntry"("stableKey");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelContextEntry_supersedesId_key" ON "ChannelContextEntry"("supersedesId");

-- CreateIndex
CREATE INDEX "ChannelContextEntry_projectId_type_status_idx" ON "ChannelContextEntry"("projectId", "type", "status");

-- CreateIndex
CREATE INDEX "ChannelContextEntry_channelId_occurredAt_idx" ON "ChannelContextEntry"("channelId", "occurredAt");

-- CreateIndex
CREATE INDEX "ChannelContextEntry_category_subject_idx" ON "ChannelContextEntry"("category", "subject");

-- CreateIndex
CREATE INDEX "ChannelContextEntry_entityType_entityId_idx" ON "ChannelContextEntry"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ChannelContextEntry_game_series_format_idx" ON "ChannelContextEntry"("game", "series", "format");

-- CreateIndex
CREATE INDEX "ChannelContextRelation_entityType_entityId_idx" ON "ChannelContextRelation"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ChannelContextRelation_contextId_createdAt_idx" ON "ChannelContextRelation"("contextId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelContextRelation_contextId_relation_entityType_entity_key" ON "ChannelContextRelation"("contextId", "relation", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceSignal_key_key" ON "PerformanceSignal"("key");

-- CreateIndex
CREATE INDEX "PerformanceSignal_projectId_game_idx" ON "PerformanceSignal"("projectId", "game");

-- CreateIndex
CREATE INDEX "PerformanceSignal_projectId_format_idx" ON "PerformanceSignal"("projectId", "format");

-- CreateIndex
CREATE INDEX "PerformanceSignal_projectId_series_idx" ON "PerformanceSignal"("projectId", "series");

-- CreateIndex
CREATE INDEX "PerformanceSignal_videoIdeaId_idx" ON "PerformanceSignal"("videoIdeaId");

-- CreateIndex
CREATE INDEX "PerformanceSignal_performanceSnapshotId_idx" ON "PerformanceSignal"("performanceSnapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoPerformanceSnapshot_ingestionKey_key" ON "VideoPerformanceSnapshot"("ingestionKey");

-- CreateIndex
CREATE INDEX "VideoPerformanceSnapshot_projectId_collectedAt_idx" ON "VideoPerformanceSnapshot"("projectId", "collectedAt");

-- CreateIndex
CREATE INDEX "VideoPerformanceSnapshot_videoId_source_idx" ON "VideoPerformanceSnapshot"("videoId", "source");

-- CreateIndex
CREATE INDEX "VideoPerformanceSnapshot_game_idx" ON "VideoPerformanceSnapshot"("game");

-- CreateIndex
CREATE INDEX "VideoPerformanceSnapshot_series_idx" ON "VideoPerformanceSnapshot"("series");

-- CreateIndex
CREATE INDEX "VideoPerformanceSnapshot_format_idx" ON "VideoPerformanceSnapshot"("format");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPackaging_contentKey_key" ON "ContentPackaging"("contentKey");

-- CreateIndex
CREATE INDEX "ContentPackaging_projectId_updatedAt_idx" ON "ContentPackaging"("projectId", "updatedAt");

-- CreateIndex
CREATE INDEX "ContentPackaging_videoId_idx" ON "ContentPackaging"("videoId");

-- CreateIndex
CREATE INDEX "ContentPackaging_game_series_format_idx" ON "ContentPackaging"("game", "series", "format");

-- CreateIndex
CREATE INDEX "PackagingVariant_packagingId_status_idx" ON "PackagingVariant"("packagingId", "status");

-- CreateIndex
CREATE INDEX "PackagingVariant_publishedVideoId_idx" ON "PackagingVariant"("publishedVideoId");

-- CreateIndex
CREATE UNIQUE INDEX "PackagingVariant_packagingId_key_key" ON "PackagingVariant"("packagingId", "key");

-- CreateIndex
CREATE INDEX "PackagingHistory_packagingId_createdAt_idx" ON "PackagingHistory"("packagingId", "createdAt");

-- CreateIndex
CREATE INDEX "PackagingHistory_variantId_createdAt_idx" ON "PackagingHistory"("variantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PackagingMetricSnapshot_ingestionKey_key" ON "PackagingMetricSnapshot"("ingestionKey");

-- CreateIndex
CREATE INDEX "PackagingMetricSnapshot_variantId_createdAt_idx" ON "PackagingMetricSnapshot"("variantId", "createdAt");

-- CreateIndex
CREATE INDEX "PackagingMetricSnapshot_videoId_periodEnd_idx" ON "PackagingMetricSnapshot"("videoId", "periodEnd");

-- CreateIndex
CREATE INDEX "PackagingMetricSnapshot_performanceSnapshotId_idx" ON "PackagingMetricSnapshot"("performanceSnapshotId");

-- CreateIndex
CREATE INDEX "PackagingExperiment_packagingId_status_idx" ON "PackagingExperiment"("packagingId", "status");

-- CreateIndex
CREATE INDEX "PackagingExperiment_contextEntryId_idx" ON "PackagingExperiment"("contextEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "TrendSignal_key_key" ON "TrendSignal"("key");

-- CreateIndex
CREATE INDEX "TrendSignal_projectId_subjectType_detectedAt_idx" ON "TrendSignal"("projectId", "subjectType", "detectedAt");

-- CreateIndex
CREATE INDEX "TrendSignal_classification_detectedAt_idx" ON "TrendSignal"("classification", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SeriesDefinition_key_key" ON "SeriesDefinition"("key");

-- CreateIndex
CREATE INDEX "SeriesDefinition_projectId_normalizedKey_idx" ON "SeriesDefinition"("projectId", "normalizedKey");

-- CreateIndex
CREATE INDEX "SeriesDefinition_status_updatedAt_idx" ON "SeriesDefinition"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "VideoSeriesLink_videoId_idx" ON "VideoSeriesLink"("videoId");

-- CreateIndex
CREATE INDEX "VideoSeriesLink_sourceSnapshotId_idx" ON "VideoSeriesLink"("sourceSnapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoSeriesLink_seriesId_videoId_key" ON "VideoSeriesLink"("seriesId", "videoId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPattern_key_key" ON "ContentPattern"("key");

-- CreateIndex
CREATE INDEX "ContentPattern_projectId_patternType_detectedAt_idx" ON "ContentPattern"("projectId", "patternType", "detectedAt");

-- CreateIndex
CREATE INDEX "ContentPattern_classification_detectedAt_idx" ON "ContentPattern"("classification", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchHistory_executionKey_key" ON "ResearchHistory"("executionKey");

-- CreateIndex
CREATE INDEX "ResearchHistory_projectId_researchedAt_idx" ON "ResearchHistory"("projectId", "researchedAt");

-- CreateIndex
CREATE INDEX "ResearchHistory_cacheKey_researchedAt_idx" ON "ResearchHistory"("cacheKey", "researchedAt");

-- CreateIndex
CREATE INDEX "ResearchHistory_quality_freshness_idx" ON "ResearchHistory"("quality", "freshness");

-- CreateIndex
CREATE INDEX "ResearchHistory_status_updatedAt_idx" ON "ResearchHistory"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "ResearchOpportunity_researchHistoryId_rank_idx" ON "ResearchOpportunity"("researchHistoryId", "rank");

-- CreateIndex
CREATE INDEX "ResearchOpportunity_state_confidence_createdAt_idx" ON "ResearchOpportunity"("state", "confidence", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchOpportunity_subjectType_subject_idx" ON "ResearchOpportunity"("subjectType", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchOpportunity_researchHistoryId_key_key" ON "ResearchOpportunity"("researchHistoryId", "key");

-- CreateIndex
CREATE INDEX "ResearchEvidenceItem_researchHistoryId_sourceType_idx" ON "ResearchEvidenceItem"("researchHistoryId", "sourceType");

-- CreateIndex
CREATE INDEX "ResearchEvidenceItem_sourceType_sourceId_idx" ON "ResearchEvidenceItem"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchEvidenceItem_researchHistoryId_evidenceKey_key" ON "ResearchEvidenceItem"("researchHistoryId", "evidenceKey");

-- CreateIndex
CREATE INDEX "ResearchSessionEvent_researchHistoryId_occurredAt_idx" ON "ResearchSessionEvent"("researchHistoryId", "occurredAt");

-- CreateIndex
CREATE INDEX "ResearchSessionEvent_event_occurredAt_idx" ON "ResearchSessionEvent"("event", "occurredAt");

-- CreateIndex
CREATE INDEX "ResearchContentGap_researchHistoryId_relevance_idx" ON "ResearchContentGap"("researchHistoryId", "relevance");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchContentGap_researchHistoryId_gapKey_key" ON "ResearchContentGap"("researchHistoryId", "gapKey");

-- CreateIndex
CREATE INDEX "ContentPlan_projectId_generatedAt_idx" ON "ContentPlan"("projectId", "generatedAt");

-- CreateIndex
CREATE INDEX "ContentPlan_status_horizon_generatedAt_idx" ON "ContentPlan"("status", "horizon", "generatedAt");

-- CreateIndex
CREATE INDEX "PlannedContentItem_planId_position_idx" ON "PlannedContentItem"("planId", "position");

-- CreateIndex
CREATE INDEX "PlannedContentItem_status_priority_readiness_idx" ON "PlannedContentItem"("status", "priority", "readiness");

-- CreateIndex
CREATE INDEX "PlannedContentItem_sourceDecisionId_idx" ON "PlannedContentItem"("sourceDecisionId");

-- CreateIndex
CREATE INDEX "PlannedContentItem_sourceResearchOpportunityId_idx" ON "PlannedContentItem"("sourceResearchOpportunityId");

-- CreateIndex
CREATE INDEX "PlannedContentItem_planId_executionState_position_idx" ON "PlannedContentItem"("planId", "executionState", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PlannedContentItem_planId_candidateKey_key" ON "PlannedContentItem"("planId", "candidateKey");

-- CreateIndex
CREATE UNIQUE INDEX "ContentProduction_productionKey_key" ON "ContentProduction"("productionKey");

-- CreateIndex
CREATE UNIQUE INDEX "ContentProduction_plannedContentItemId_key" ON "ContentProduction"("plannedContentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentProduction_packagingId_key" ON "ContentProduction"("packagingId");

-- CreateIndex
CREATE INDEX "ContentProduction_projectId_status_updatedAt_idx" ON "ContentProduction"("projectId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "ContentProduction_format_currentStage_updatedAt_idx" ON "ContentProduction"("format", "currentStage", "updatedAt");

-- CreateIndex
CREATE INDEX "ContentProduction_publishedVideoId_idx" ON "ContentProduction"("publishedVideoId");

-- CreateIndex
CREATE INDEX "ContentProduction_videoIdeaId_idx" ON "ContentProduction"("videoIdeaId");

-- CreateIndex
CREATE INDEX "ContentProduction_seriesId_idx" ON "ContentProduction"("seriesId");

-- CreateIndex
CREATE UNIQUE INDEX "TimedTranscript_fingerprint_key" ON "TimedTranscript"("fingerprint");

-- CreateIndex
CREATE INDEX "TimedTranscript_productionId_createdAt_idx" ON "TimedTranscript"("productionId", "createdAt");

-- CreateIndex
CREATE INDEX "TimedTranscript_videoId_createdAt_idx" ON "TimedTranscript"("videoId", "createdAt");

-- CreateIndex
CREATE INDEX "TimedTranscript_libraryItemId_idx" ON "TimedTranscript"("libraryItemId");

-- CreateIndex
CREATE INDEX "TimedTranscriptSegment_transcriptId_startMs_idx" ON "TimedTranscriptSegment"("transcriptId", "startMs");

-- CreateIndex
CREATE UNIQUE INDEX "TimedTranscriptSegment_transcriptId_position_key" ON "TimedTranscriptSegment"("transcriptId", "position");

-- CreateIndex
CREATE INDEX "ChapterSet_productionId_status_createdAt_idx" ON "ChapterSet"("productionId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ChapterSet_transcriptId_createdAt_idx" ON "ChapterSet"("transcriptId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChapterSet_productionId_version_key" ON "ChapterSet"("productionId", "version");

-- CreateIndex
CREATE INDEX "ChapterEntry_chapterSetId_startMs_idx" ON "ChapterEntry"("chapterSetId", "startMs");

-- CreateIndex
CREATE UNIQUE INDEX "ChapterEntry_chapterSetId_position_key" ON "ChapterEntry"("chapterSetId", "position");

-- CreateIndex
CREATE INDEX "ShortAnalysis_productionId_status_idx" ON "ShortAnalysis"("productionId", "status");

-- CreateIndex
CREATE INDEX "ShortAnalysis_transcriptId_idx" ON "ShortAnalysis"("transcriptId");

-- CreateIndex
CREATE UNIQUE INDEX "ShortAnalysis_productionId_version_key" ON "ShortAnalysis"("productionId", "version");

-- CreateIndex
CREATE INDEX "ClipCandidate_analysisId_status_score_idx" ON "ClipCandidate"("analysisId", "status", "score");

-- CreateIndex
CREATE INDEX "ClipCandidate_analysisId_momentKey_idx" ON "ClipCandidate"("analysisId", "momentKey");

-- CreateIndex
CREATE INDEX "ClipRenderJob_productionId_createdAt_idx" ON "ClipRenderJob"("productionId", "createdAt");

-- CreateIndex
CREATE INDEX "ClipRenderJob_status_createdAt_idx" ON "ClipRenderJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClipRenderJob_snapshotKey_attempt_key" ON "ClipRenderJob"("snapshotKey", "attempt");

-- CreateIndex
CREATE INDEX "ClipRevision_analysisId_createdAt_idx" ON "ClipRevision"("analysisId", "createdAt");

-- CreateIndex
CREATE INDEX "ChapterRevision_chapterSetId_createdAt_idx" ON "ChapterRevision"("chapterSetId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductionStep_productionId_position_idx" ON "ProductionStep"("productionId", "position");

-- CreateIndex
CREATE INDEX "ProductionStep_state_updatedAt_idx" ON "ProductionStep"("state", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionStep_productionId_key_key" ON "ProductionStep"("productionId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionStep_productionId_key_executionKey_key" ON "ProductionStep"("productionId", "key", "executionKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionEvent_operationKey_key" ON "ProductionEvent"("operationKey");

-- CreateIndex
CREATE INDEX "ProductionEvent_productionId_createdAt_idx" ON "ProductionEvent"("productionId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductionEvent_productionId_stepKey_createdAt_idx" ON "ProductionEvent"("productionId", "stepKey", "createdAt");

-- CreateIndex
CREATE INDEX "ProductionEvent_event_createdAt_idx" ON "ProductionEvent"("event", "createdAt");

-- CreateIndex
CREATE INDEX "ProductionAssetRelation_productionId_createdAt_idx" ON "ProductionAssetRelation"("productionId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductionAssetRelation_libraryItemId_idx" ON "ProductionAssetRelation"("libraryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionAssetRelation_productionId_libraryItemId_role_key" ON "ProductionAssetRelation"("productionId", "libraryItemId", "role");

-- CreateIndex
CREATE INDEX "PlanningHistory_planId_createdAt_idx" ON "PlanningHistory"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanningHistory_itemId_createdAt_idx" ON "PlanningHistory"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanningHistory_event_createdAt_idx" ON "PlanningHistory"("event", "createdAt");

-- CreateIndex
CREATE INDEX "PlanningExecutionEvent_planId_createdAt_idx" ON "PlanningExecutionEvent"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanningExecutionEvent_itemId_createdAt_idx" ON "PlanningExecutionEvent"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanningExecutionEvent_state_createdAt_idx" ON "PlanningExecutionEvent"("state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlanningOutcomeLink_activeItemKey_key" ON "PlanningOutcomeLink"("activeItemKey");

-- CreateIndex
CREATE UNIQUE INDEX "PlanningOutcomeLink_activeVideoKey_key" ON "PlanningOutcomeLink"("activeVideoKey");

-- CreateIndex
CREATE INDEX "PlanningOutcomeLink_planId_linkedAt_idx" ON "PlanningOutcomeLink"("planId", "linkedAt");

-- CreateIndex
CREATE INDEX "PlanningOutcomeLink_itemId_linkedAt_idx" ON "PlanningOutcomeLink"("itemId", "linkedAt");

-- CreateIndex
CREATE INDEX "PlanningOutcomeLink_videoId_linkedAt_idx" ON "PlanningOutcomeLink"("videoId", "linkedAt");

-- CreateIndex
CREATE INDEX "PlanningOutcomeLink_executionEventId_idx" ON "PlanningOutcomeLink"("executionEventId");

-- CreateIndex
CREATE INDEX "PlanningOutcomeLink_sourceSnapshotId_idx" ON "PlanningOutcomeLink"("sourceSnapshotId");

-- CreateIndex
CREATE INDEX "PlanningOutcome_planId_evaluatedAt_idx" ON "PlanningOutcome"("planId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "PlanningOutcome_itemId_evaluatedAt_idx" ON "PlanningOutcome"("itemId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "PlanningOutcome_videoId_observedAt_idx" ON "PlanningOutcome"("videoId", "observedAt");

-- CreateIndex
CREATE INDEX "PlanningOutcome_snapshotId_idx" ON "PlanningOutcome"("snapshotId");

-- CreateIndex
CREATE INDEX "PlanningOutcome_classification_evaluatedAt_idx" ON "PlanningOutcome"("classification", "evaluatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlanningOutcome_linkId_snapshotId_key" ON "PlanningOutcome"("linkId", "snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "StrategicLearning_key_key" ON "StrategicLearning"("key");

-- CreateIndex
CREATE INDEX "StrategicLearning_projectId_status_confidence_idx" ON "StrategicLearning"("projectId", "status", "confidence");

-- CreateIndex
CREATE INDEX "StrategicLearning_dimension_subject_idx" ON "StrategicLearning"("dimension", "subject");

-- CreateIndex
CREATE INDEX "StrategicLearning_freshness_updatedAt_idx" ON "StrategicLearning"("freshness", "updatedAt");

-- CreateIndex
CREATE INDEX "StrategicExperiment_projectId_status_updatedAt_idx" ON "StrategicExperiment"("projectId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "StrategicExperiment_sourceLearningId_idx" ON "StrategicExperiment"("sourceLearningId");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentHypothesis_experimentId_key" ON "ExperimentHypothesis"("experimentId");

-- CreateIndex
CREATE INDEX "ExperimentVariant_plannedItemId_idx" ON "ExperimentVariant"("plannedItemId");

-- CreateIndex
CREATE INDEX "ExperimentVariant_executionEventId_idx" ON "ExperimentVariant"("executionEventId");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentVariant_experimentId_key_key" ON "ExperimentVariant"("experimentId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentMetric_experimentId_name_key" ON "ExperimentMetric"("experimentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentConstraint_experimentId_code_key" ON "ExperimentConstraint"("experimentId", "code");

-- CreateIndex
CREATE INDEX "ExperimentObservation_variantId_observedAt_idx" ON "ExperimentObservation"("variantId", "observedAt");

-- CreateIndex
CREATE INDEX "ExperimentObservation_outcomeId_idx" ON "ExperimentObservation"("outcomeId");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentObservation_experimentId_outcomeId_key" ON "ExperimentObservation"("experimentId", "outcomeId");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentResult_experimentId_key" ON "ExperimentResult"("experimentId");

-- CreateIndex
CREATE INDEX "ExperimentEvidence_resultId_idx" ON "ExperimentEvidence"("resultId");

-- CreateIndex
CREATE INDEX "ExperimentEvidence_learningId_idx" ON "ExperimentEvidence"("learningId");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentEvidence_experimentId_observationId_key" ON "ExperimentEvidence"("experimentId", "observationId");

-- CreateIndex
CREATE INDEX "ExperimentEvent_experimentId_createdAt_idx" ON "ExperimentEvent"("experimentId", "createdAt");

-- CreateIndex
CREATE INDEX "ExperimentEvent_event_createdAt_idx" ON "ExperimentEvent"("event", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringRule_code_key" ON "MonitoringRule"("code");

-- CreateIndex
CREATE INDEX "MonitoringRule_enabled_signalType_idx" ON "MonitoringRule"("enabled", "signalType");

-- CreateIndex
CREATE INDEX "MonitoringControl_enabled_nextRunAt_idx" ON "MonitoringControl"("enabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "StrategicSignal_logicalKey_key" ON "StrategicSignal"("logicalKey");

-- CreateIndex
CREATE INDEX "StrategicSignal_projectId_state_severity_detectedAt_idx" ON "StrategicSignal"("projectId", "state", "severity", "detectedAt");

-- CreateIndex
CREATE INDEX "StrategicSignal_type_state_lastObservedAt_idx" ON "StrategicSignal"("type", "state", "lastObservedAt");

-- CreateIndex
CREATE INDEX "StrategicSignal_source_sourceId_idx" ON "StrategicSignal"("source", "sourceId");

-- CreateIndex
CREATE INDEX "StrategicSignal_fingerprint_idx" ON "StrategicSignal"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringSnapshot_evaluationFingerprint_key" ON "MonitoringSnapshot"("evaluationFingerprint");

-- CreateIndex
CREATE INDEX "MonitoringSnapshot_projectId_evaluatedAt_idx" ON "MonitoringSnapshot"("projectId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "SignalEvidence_signalId_observedAt_idx" ON "SignalEvidence"("signalId", "observedAt");

-- CreateIndex
CREATE INDEX "SignalEvidence_snapshotId_idx" ON "SignalEvidence"("snapshotId");

-- CreateIndex
CREATE INDEX "SignalEvidence_source_sourceId_idx" ON "SignalEvidence"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "SignalEvidence_signalId_snapshotId_kind_key" ON "SignalEvidence"("signalId", "snapshotId", "kind");

-- CreateIndex
CREATE INDEX "StrategicLearningEvidence_outcomeId_idx" ON "StrategicLearningEvidence"("outcomeId");

-- CreateIndex
CREATE INDEX "StrategicLearningEvidence_learningId_stance_idx" ON "StrategicLearningEvidence"("learningId", "stance");

-- CreateIndex
CREATE UNIQUE INDEX "StrategicLearningEvidence_learningId_outcomeId_key" ON "StrategicLearningEvidence"("learningId", "outcomeId");

-- CreateIndex
CREATE INDEX "StrategicLearningRevision_learningId_createdAt_idx" ON "StrategicLearningRevision"("learningId", "createdAt");

-- CreateIndex
CREATE INDEX "StrategicLearningRevision_event_createdAt_idx" ON "StrategicLearningRevision"("event", "createdAt");

-- CreateIndex
CREATE INDEX "PlanningOutcomeAuditEvent_planId_createdAt_idx" ON "PlanningOutcomeAuditEvent"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanningOutcomeAuditEvent_itemId_createdAt_idx" ON "PlanningOutcomeAuditEvent"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanningOutcomeAuditEvent_linkId_createdAt_idx" ON "PlanningOutcomeAuditEvent"("linkId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanningOutcomeAuditEvent_outcomeId_createdAt_idx" ON "PlanningOutcomeAuditEvent"("outcomeId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanningOutcomeAuditEvent_event_createdAt_idx" ON "PlanningOutcomeAuditEvent"("event", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VideoReachSnapshot_ingestionKey_key" ON "VideoReachSnapshot"("ingestionKey");

-- CreateIndex
CREATE INDEX "VideoReachSnapshot_projectId_collectedAt_idx" ON "VideoReachSnapshot"("projectId", "collectedAt");

-- CreateIndex
CREATE INDEX "VideoReachSnapshot_videoId_periodStart_periodEnd_source_idx" ON "VideoReachSnapshot"("videoId", "periodStart", "periodEnd", "source");

-- CreateIndex
CREATE INDEX "VideoReachSnapshot_source_collectedAt_idx" ON "VideoReachSnapshot"("source", "collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AudienceSnapshot_ingestionKey_key" ON "AudienceSnapshot"("ingestionKey");

-- CreateIndex
CREATE INDEX "AudienceSnapshot_projectId_dimension_periodStart_periodEnd_idx" ON "AudienceSnapshot"("projectId", "dimension", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "AudienceSnapshot_dimension_segment_format_idx" ON "AudienceSnapshot"("dimension", "segment", "format");

-- CreateIndex
CREATE INDEX "AudienceSnapshot_source_collectedAt_idx" ON "AudienceSnapshot"("source", "collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialDecision_operatorMessageId_key" ON "EditorialDecision"("operatorMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialDecision_dedupeKey_key" ON "EditorialDecision"("dedupeKey");

-- CreateIndex
CREATE INDEX "EditorialDecision_projectId_createdAt_idx" ON "EditorialDecision"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "EditorialDecision_conversationId_createdAt_idx" ON "EditorialDecision"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "EditorialDecision_category_createdAt_idx" ON "EditorialDecision"("category", "createdAt");

-- CreateIndex
CREATE INDEX "EditorialDecision_candidateType_candidateKey_idx" ON "EditorialDecision"("candidateType", "candidateKey");

-- CreateIndex
CREATE INDEX "EditorialDecision_outcomeSnapshotId_idx" ON "EditorialDecision"("outcomeSnapshotId");

-- CreateIndex
CREATE INDEX "EditorialDecisionVideoLink_decisionId_linkedAt_idx" ON "EditorialDecisionVideoLink"("decisionId", "linkedAt");

-- CreateIndex
CREATE INDEX "EditorialDecisionVideoLink_videoId_idx" ON "EditorialDecisionVideoLink"("videoId");

-- CreateIndex
CREATE INDEX "EditorialDecisionVideoLink_sourceSnapshotId_idx" ON "EditorialDecisionVideoLink"("sourceSnapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialDecisionVideoLink_decisionId_videoId_key" ON "EditorialDecisionVideoLink"("decisionId", "videoId");

-- CreateIndex
CREATE INDEX "EditorialDecisionOutcome_snapshotId_idx" ON "EditorialDecisionOutcome"("snapshotId");

-- CreateIndex
CREATE INDEX "EditorialDecisionOutcome_classification_evaluatedAt_idx" ON "EditorialDecisionOutcome"("classification", "evaluatedAt");

-- CreateIndex
CREATE INDEX "EditorialDecisionOutcome_learningInsightId_idx" ON "EditorialDecisionOutcome"("learningInsightId");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialDecisionOutcome_decisionVideoLinkId_snapshotId_key" ON "EditorialDecisionOutcome"("decisionVideoLinkId", "snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialDecisionOutcomeReview_reviewKey_key" ON "EditorialDecisionOutcomeReview"("reviewKey");

-- CreateIndex
CREATE INDEX "EditorialDecisionOutcomeReview_sourceOutcomeId_startedAt_idx" ON "EditorialDecisionOutcomeReview"("sourceOutcomeId", "startedAt");

-- CreateIndex
CREATE INDEX "EditorialDecisionOutcomeReview_status_startedAt_idx" ON "EditorialDecisionOutcomeReview"("status", "startedAt");

-- CreateIndex
CREATE INDEX "EditorialDecisionOutcomeReview_currentSnapshotId_idx" ON "EditorialDecisionOutcomeReview"("currentSnapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "OrchestrationExecution_idempotencyKey_key" ON "OrchestrationExecution"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OrchestrationExecution_projectId_createdAt_idx" ON "OrchestrationExecution"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "OrchestrationExecution_conversationId_createdAt_idx" ON "OrchestrationExecution"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "OrchestrationExecution_status_createdAt_idx" ON "OrchestrationExecution"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlanReview_executionId_key" ON "PlanReview"("executionId");

-- CreateIndex
CREATE INDEX "PlanReview_state_createdAt_idx" ON "PlanReview"("state", "createdAt");

-- CreateIndex
CREATE INDEX "PlanReview_riskLevel_createdAt_idx" ON "PlanReview"("riskLevel", "createdAt");

-- CreateIndex
CREATE INDEX "OrchestrationAuditEvent_executionId_createdAt_idx" ON "OrchestrationAuditEvent"("executionId", "createdAt");

-- CreateIndex
CREATE INDEX "OrchestrationAuditEvent_eventType_createdAt_idx" ON "OrchestrationAuditEvent"("eventType", "createdAt");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryItem" ADD CONSTRAINT "LibraryItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryItem" ADD CONSTRAINT "LibraryItem_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalMediaSource" ADD CONSTRAINT "LocalMediaSource_libraryItemId_fkey" FOREIGN KEY ("libraryItemId") REFERENCES "LibraryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationLibraryItem" ADD CONSTRAINT "ConversationLibraryItem_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationLibraryItem" ADD CONSTRAINT "ConversationLibraryItem_libraryItemId_fkey" FOREIGN KEY ("libraryItemId") REFERENCES "LibraryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationGovernancePolicy" ADD CONSTRAINT "AutomationGovernancePolicy_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAuditEvent" ADD CONSTRAINT "AutomationAuditEvent_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsSnapshot" ADD CONSTRAINT "AnalyticsSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoIdea" ADD CONSTRAINT "VideoIdea_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoIdea" ADD CONSTRAINT "VideoIdea_sourceResearchHistoryId_fkey" FOREIGN KEY ("sourceResearchHistoryId") REFERENCES "ResearchHistory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoIdea" ADD CONSTRAINT "VideoIdea_sourceOpportunityId_fkey" FOREIGN KEY ("sourceOpportunityId") REFERENCES "ResearchOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoIdea" ADD CONSTRAINT "VideoIdea_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "VideoIdea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentOpportunity" ADD CONSTRAINT "ContentOpportunity_videoIdeaId_fkey" FOREIGN KEY ("videoIdeaId") REFERENCES "VideoIdea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentDecision" ADD CONSTRAINT "ContentDecision_videoIdeaId_fkey" FOREIGN KEY ("videoIdeaId") REFERENCES "VideoIdea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelInsight" ADD CONSTRAINT "ChannelInsight_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelContextEntry" ADD CONSTRAINT "ChannelContextEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelContextEntry" ADD CONSTRAINT "ChannelContextEntry_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "ChannelContextEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelContextRelation" ADD CONSTRAINT "ChannelContextRelation_contextId_fkey" FOREIGN KEY ("contextId") REFERENCES "ChannelContextEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceSignal" ADD CONSTRAINT "PerformanceSignal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceSignal" ADD CONSTRAINT "PerformanceSignal_videoIdeaId_fkey" FOREIGN KEY ("videoIdeaId") REFERENCES "VideoIdea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceSignal" ADD CONSTRAINT "PerformanceSignal_performanceSnapshotId_fkey" FOREIGN KEY ("performanceSnapshotId") REFERENCES "VideoPerformanceSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoPerformanceSnapshot" ADD CONSTRAINT "VideoPerformanceSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPackaging" ADD CONSTRAINT "ContentPackaging_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagingVariant" ADD CONSTRAINT "PackagingVariant_packagingId_fkey" FOREIGN KEY ("packagingId") REFERENCES "ContentPackaging"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagingHistory" ADD CONSTRAINT "PackagingHistory_packagingId_fkey" FOREIGN KEY ("packagingId") REFERENCES "ContentPackaging"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagingMetricSnapshot" ADD CONSTRAINT "PackagingMetricSnapshot_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PackagingVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagingMetricSnapshot" ADD CONSTRAINT "PackagingMetricSnapshot_performanceSnapshotId_fkey" FOREIGN KEY ("performanceSnapshotId") REFERENCES "VideoPerformanceSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagingExperiment" ADD CONSTRAINT "PackagingExperiment_packagingId_fkey" FOREIGN KEY ("packagingId") REFERENCES "ContentPackaging"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrendSignal" ADD CONSTRAINT "TrendSignal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeriesDefinition" ADD CONSTRAINT "SeriesDefinition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoSeriesLink" ADD CONSTRAINT "VideoSeriesLink_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "SeriesDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoSeriesLink" ADD CONSTRAINT "VideoSeriesLink_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "VideoPerformanceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPattern" ADD CONSTRAINT "ContentPattern_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchHistory" ADD CONSTRAINT "ResearchHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchOpportunity" ADD CONSTRAINT "ResearchOpportunity_researchHistoryId_fkey" FOREIGN KEY ("researchHistoryId") REFERENCES "ResearchHistory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchEvidenceItem" ADD CONSTRAINT "ResearchEvidenceItem_researchHistoryId_fkey" FOREIGN KEY ("researchHistoryId") REFERENCES "ResearchHistory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSessionEvent" ADD CONSTRAINT "ResearchSessionEvent_researchHistoryId_fkey" FOREIGN KEY ("researchHistoryId") REFERENCES "ResearchHistory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchContentGap" ADD CONSTRAINT "ResearchContentGap_researchHistoryId_fkey" FOREIGN KEY ("researchHistoryId") REFERENCES "ResearchHistory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlan" ADD CONSTRAINT "ContentPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedContentItem" ADD CONSTRAINT "PlannedContentItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedContentItem" ADD CONSTRAINT "PlannedContentItem_sourceDecisionId_fkey" FOREIGN KEY ("sourceDecisionId") REFERENCES "EditorialDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedContentItem" ADD CONSTRAINT "PlannedContentItem_sourceResearchOpportunityId_fkey" FOREIGN KEY ("sourceResearchOpportunityId") REFERENCES "ResearchOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedContentItem" ADD CONSTRAINT "PlannedContentItem_researchHistoryId_fkey" FOREIGN KEY ("researchHistoryId") REFERENCES "ResearchHistory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedContentItem" ADD CONSTRAINT "PlannedContentItem_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "SeriesDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentProduction" ADD CONSTRAINT "ContentProduction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentProduction" ADD CONSTRAINT "ContentProduction_videoIdeaId_fkey" FOREIGN KEY ("videoIdeaId") REFERENCES "VideoIdea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentProduction" ADD CONSTRAINT "ContentProduction_plannedContentItemId_fkey" FOREIGN KEY ("plannedContentItemId") REFERENCES "PlannedContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentProduction" ADD CONSTRAINT "ContentProduction_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "SeriesDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentProduction" ADD CONSTRAINT "ContentProduction_packagingId_fkey" FOREIGN KEY ("packagingId") REFERENCES "ContentPackaging"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimedTranscript" ADD CONSTRAINT "TimedTranscript_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "ContentProduction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimedTranscript" ADD CONSTRAINT "TimedTranscript_libraryItemId_fkey" FOREIGN KEY ("libraryItemId") REFERENCES "LibraryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimedTranscriptSegment" ADD CONSTRAINT "TimedTranscriptSegment_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "TimedTranscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterSet" ADD CONSTRAINT "ChapterSet_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "ContentProduction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterSet" ADD CONSTRAINT "ChapterSet_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "TimedTranscript"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterEntry" ADD CONSTRAINT "ChapterEntry_chapterSetId_fkey" FOREIGN KEY ("chapterSetId") REFERENCES "ChapterSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortAnalysis" ADD CONSTRAINT "ShortAnalysis_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "ContentProduction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortAnalysis" ADD CONSTRAINT "ShortAnalysis_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "TimedTranscript"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipCandidate" ADD CONSTRAINT "ClipCandidate_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ShortAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipRenderJob" ADD CONSTRAINT "ClipRenderJob_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ClipCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipRenderJob" ADD CONSTRAINT "ClipRenderJob_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LocalMediaSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipRenderJob" ADD CONSTRAINT "ClipRenderJob_outputLibraryItemId_fkey" FOREIGN KEY ("outputLibraryItemId") REFERENCES "LibraryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipRevision" ADD CONSTRAINT "ClipRevision_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ShortAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterRevision" ADD CONSTRAINT "ChapterRevision_chapterSetId_fkey" FOREIGN KEY ("chapterSetId") REFERENCES "ChapterSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionStep" ADD CONSTRAINT "ProductionStep_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "ContentProduction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionEvent" ADD CONSTRAINT "ProductionEvent_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "ContentProduction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionAssetRelation" ADD CONSTRAINT "ProductionAssetRelation_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "ContentProduction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionAssetRelation" ADD CONSTRAINT "ProductionAssetRelation_libraryItemId_fkey" FOREIGN KEY ("libraryItemId") REFERENCES "LibraryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningHistory" ADD CONSTRAINT "PlanningHistory_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningHistory" ADD CONSTRAINT "PlanningHistory_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PlannedContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningExecutionEvent" ADD CONSTRAINT "PlanningExecutionEvent_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningExecutionEvent" ADD CONSTRAINT "PlanningExecutionEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PlannedContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningOutcomeLink" ADD CONSTRAINT "PlanningOutcomeLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningOutcomeLink" ADD CONSTRAINT "PlanningOutcomeLink_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningOutcomeLink" ADD CONSTRAINT "PlanningOutcomeLink_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PlannedContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningOutcomeLink" ADD CONSTRAINT "PlanningOutcomeLink_executionEventId_fkey" FOREIGN KEY ("executionEventId") REFERENCES "PlanningExecutionEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningOutcomeLink" ADD CONSTRAINT "PlanningOutcomeLink_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "VideoPerformanceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningOutcome" ADD CONSTRAINT "PlanningOutcome_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningOutcome" ADD CONSTRAINT "PlanningOutcome_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningOutcome" ADD CONSTRAINT "PlanningOutcome_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PlannedContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningOutcome" ADD CONSTRAINT "PlanningOutcome_executionEventId_fkey" FOREIGN KEY ("executionEventId") REFERENCES "PlanningExecutionEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningOutcome" ADD CONSTRAINT "PlanningOutcome_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "PlanningOutcomeLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningOutcome" ADD CONSTRAINT "PlanningOutcome_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "VideoPerformanceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicLearning" ADD CONSTRAINT "StrategicLearning_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicExperiment" ADD CONSTRAINT "StrategicExperiment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicExperiment" ADD CONSTRAINT "StrategicExperiment_sourceLearningId_fkey" FOREIGN KEY ("sourceLearningId") REFERENCES "StrategicLearning"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentHypothesis" ADD CONSTRAINT "ExperimentHypothesis_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "StrategicExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentVariant" ADD CONSTRAINT "ExperimentVariant_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "StrategicExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentVariant" ADD CONSTRAINT "ExperimentVariant_plannedItemId_fkey" FOREIGN KEY ("plannedItemId") REFERENCES "PlannedContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentVariant" ADD CONSTRAINT "ExperimentVariant_executionEventId_fkey" FOREIGN KEY ("executionEventId") REFERENCES "PlanningExecutionEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentMetric" ADD CONSTRAINT "ExperimentMetric_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "StrategicExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentConstraint" ADD CONSTRAINT "ExperimentConstraint_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "StrategicExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentObservation" ADD CONSTRAINT "ExperimentObservation_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "StrategicExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentObservation" ADD CONSTRAINT "ExperimentObservation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ExperimentVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentObservation" ADD CONSTRAINT "ExperimentObservation_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "PlanningOutcome"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentResult" ADD CONSTRAINT "ExperimentResult_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "StrategicExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentEvidence" ADD CONSTRAINT "ExperimentEvidence_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "StrategicExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentEvidence" ADD CONSTRAINT "ExperimentEvidence_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "ExperimentResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentEvidence" ADD CONSTRAINT "ExperimentEvidence_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "ExperimentObservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentEvidence" ADD CONSTRAINT "ExperimentEvidence_learningId_fkey" FOREIGN KEY ("learningId") REFERENCES "StrategicLearning"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentEvent" ADD CONSTRAINT "ExperimentEvent_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "StrategicExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicSignal" ADD CONSTRAINT "StrategicSignal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringSnapshot" ADD CONSTRAINT "MonitoringSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalEvidence" ADD CONSTRAINT "SignalEvidence_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "StrategicSignal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalEvidence" ADD CONSTRAINT "SignalEvidence_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MonitoringSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicLearningEvidence" ADD CONSTRAINT "StrategicLearningEvidence_learningId_fkey" FOREIGN KEY ("learningId") REFERENCES "StrategicLearning"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicLearningEvidence" ADD CONSTRAINT "StrategicLearningEvidence_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "PlanningOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicLearningRevision" ADD CONSTRAINT "StrategicLearningRevision_learningId_fkey" FOREIGN KEY ("learningId") REFERENCES "StrategicLearning"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningOutcomeAuditEvent" ADD CONSTRAINT "PlanningOutcomeAuditEvent_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningOutcomeAuditEvent" ADD CONSTRAINT "PlanningOutcomeAuditEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PlannedContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningOutcomeAuditEvent" ADD CONSTRAINT "PlanningOutcomeAuditEvent_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "PlanningOutcomeLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningOutcomeAuditEvent" ADD CONSTRAINT "PlanningOutcomeAuditEvent_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "PlanningOutcome"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoReachSnapshot" ADD CONSTRAINT "VideoReachSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudienceSnapshot" ADD CONSTRAINT "AudienceSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialDecision" ADD CONSTRAINT "EditorialDecision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialDecision" ADD CONSTRAINT "EditorialDecision_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialDecision" ADD CONSTRAINT "EditorialDecision_operatorMessageId_fkey" FOREIGN KEY ("operatorMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialDecision" ADD CONSTRAINT "EditorialDecision_outcomeSnapshotId_fkey" FOREIGN KEY ("outcomeSnapshotId") REFERENCES "VideoPerformanceSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialDecisionVideoLink" ADD CONSTRAINT "EditorialDecisionVideoLink_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "EditorialDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialDecisionVideoLink" ADD CONSTRAINT "EditorialDecisionVideoLink_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "VideoPerformanceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialDecisionOutcome" ADD CONSTRAINT "EditorialDecisionOutcome_decisionVideoLinkId_fkey" FOREIGN KEY ("decisionVideoLinkId") REFERENCES "EditorialDecisionVideoLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialDecisionOutcome" ADD CONSTRAINT "EditorialDecisionOutcome_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "VideoPerformanceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialDecisionOutcome" ADD CONSTRAINT "EditorialDecisionOutcome_learningInsightId_fkey" FOREIGN KEY ("learningInsightId") REFERENCES "ChannelInsight"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialDecisionOutcomeReview" ADD CONSTRAINT "EditorialDecisionOutcomeReview_sourceOutcomeId_fkey" FOREIGN KEY ("sourceOutcomeId") REFERENCES "EditorialDecisionOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialDecisionOutcomeReview" ADD CONSTRAINT "EditorialDecisionOutcomeReview_resultOutcomeId_fkey" FOREIGN KEY ("resultOutcomeId") REFERENCES "EditorialDecisionOutcome"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialDecisionOutcomeReview" ADD CONSTRAINT "EditorialDecisionOutcomeReview_previousSnapshotId_fkey" FOREIGN KEY ("previousSnapshotId") REFERENCES "VideoPerformanceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialDecisionOutcomeReview" ADD CONSTRAINT "EditorialDecisionOutcomeReview_currentSnapshotId_fkey" FOREIGN KEY ("currentSnapshotId") REFERENCES "VideoPerformanceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrchestrationExecution" ADD CONSTRAINT "OrchestrationExecution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanReview" ADD CONSTRAINT "PlanReview_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "OrchestrationExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrchestrationAuditEvent" ADD CONSTRAINT "OrchestrationAuditEvent_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "OrchestrationExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
