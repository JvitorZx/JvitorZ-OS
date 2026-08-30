export type LegacyOrchestrationIntent =
  | 'next_content'
  | 'outcome_status'
  | 'channel_status'
  | 'series_viability'
  | 'controlled_sync_review'
  | 'ctr_analysis'
  | 'retention_analysis'
  | 'long_form_analysis'
  | 'shorts_analysis'
  | 'channel_content_health'
  | 'audience_analysis'
  | 'trend_analysis'
  | 'general_operations';

export type ManagerIntent =
  | 'CHANNEL_DIAGNOSIS'
  | 'CONTENT_DECISION'
  | 'IDEA_COMPARISON'
  | 'SERIES_ANALYSIS'
  | 'SHORTS_ANALYSIS'
  | 'LONGFORM_ANALYSIS'
  | 'CTR_ANALYSIS'
  | 'RETENTION_ANALYSIS'
  | 'TREND_ANALYSIS'
  | 'AUDIENCE_ANALYSIS'
  | 'TRAFFIC_ANALYSIS'
  | 'PLANNING'
  | 'CONTENT_PLANNING'
  | 'OPPORTUNITY_DISCOVERY'
  | 'RESEARCH_DISCOVERY'
  | 'RISK_ANALYSIS'
  | 'GENERAL_CREATOR_QUESTION'
  | 'UNKNOWN';

export type OrchestrationIntent = LegacyOrchestrationIntent | ManagerIntent;
export type OperatorCapability =
  | 'performance'
  | 'analytics'
  | 'data-quality'
  | 'ctr'
  | 'retention'
  | 'long-form'
  | 'shorts'
  | 'trends'
  | 'series'
  | 'audience'
  | 'traffic-sources'
  | 'editorial-decision'
  | 'decision-memory'
  | 'shared-memory'
  | 'supervision'
  | 'research'
  | 'planning'
  | 'response';

export type CapabilityAccess = 'read' | 'write' | 'external_side_effect';
export type CapabilitySideEffect = 'READ_ONLY' | 'INTERNAL_WRITE' | 'EXTERNAL_READ' | 'EXTERNAL_WRITE';
export type OrchestrationRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type PlanReviewState = 'draft' | 'review_required' | 'approved' | 'rejected' | 'expired' | 'executed';
export type OrchestrationExecutionStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed';
export type OrchestrationStepStatus = 'pending' | 'completed' | 'skipped' | 'failed';

export interface OrchestrationRequest {
  intent: string;
  managerIntent?: ManagerIntent;
  projectId?: string | null;
  conversationId?: string | null;
  idempotencyKey?: string;
  confirmExternalSideEffect?: boolean;
  context?: OrchestrationContext;
  sync?: {
    mode: 'video' | 'recent' | 'period';
    startDate: string;
    endDate: string;
    videoId?: string;
    limit?: number;
  };
}

export interface CapabilityDefinition {
  id: string;
  responsibility: string;
  inputs: string[];
  outputs: string[];
  availability: 'available' | 'unavailable';
  capabilityTags?: OperatorCapability[];
  unavailableReason?: string;
  dependencies: string[];
  access: CapabilityAccess;
  sideEffect: CapabilitySideEffect;
  persistentMutation: boolean;
  maxAffectedItems?: number;
}

export interface OrchestrationStep {
  id: string;
  capabilityId: string;
  objective: string;
  dependencies: string[];
  access: CapabilityAccess;
  sideEffect: CapabilitySideEffect;
  persistentMutation: boolean;
  maxAffectedItems?: number;
  inputs: string[];
  outputs: string[];
  optional: boolean;
  condition?: {
    stepId: string;
    dataField: string;
    operator: 'greater_than';
    value: number;
  };
}

export interface OrchestrationPlan {
  intent: OrchestrationIntent;
  objective: string;
  steps: OrchestrationStep[];
  capabilities: string[];
  requiresWrite: boolean;
  hasExternalSideEffect: boolean;
  missingData: string[];
}

export interface PlanRiskAssessment {
  riskLevel: OrchestrationRiskLevel;
  sideEffectLevel: CapabilitySideEffect;
  requiredApprovals: number;
  reasons: string[];
  validityMinutes: number;
}

export interface PlanPreview {
  executionId: string;
  plan: OrchestrationPlan;
  review: {
    state: PlanReviewState;
    riskLevel: OrchestrationRiskLevel;
    sideEffectLevel: CapabilitySideEffect;
    requiredApprovals: number;
    version: number;
    reasons: string[];
    validUntil: Date;
  };
  created: boolean;
}

export interface CapabilityOutput {
  summary: string;
  facts?: string[];
  inferences?: string[];
  recommendations?: string[];
  risks?: string[];
  missingData?: string[];
  confidence?: number;
  data?: Record<string, unknown>;
  skipped?: boolean;
}

export interface OrchestrationContext {
  projectId?: string | null;
  conversationId?: string | null;
  candidateLabels?: string[];
  relevantMemoryLimit?: number;
}

export interface OperatorInvocation {
  stepId: string;
  operatorId: string;
  capabilityId: string;
  reason: string;
  status: OrchestrationStepStatus;
  durationMs: number;
  errorType?: string;
}

export interface OrchestrationEvidence {
  classification: 'fact' | 'inference' | 'recommendation';
  summary: string;
  operatorId: string;
}

export interface OrchestrationConflict {
  code: string;
  summary: string;
  operatorIds: string[];
  effect: 'reduces_confidence' | 'requires_more_data';
}

export interface ConsolidatedConfidenceBasis {
  operatorAvailability: number;
  dataQuality: number;
  freshness: number;
  sampleStrength: number;
  conflictPenalty: number;
  missingDataPenalty: number;
}

export interface OrchestrationStepResult {
  stepId: string;
  capabilityId: string;
  status: OrchestrationStepStatus;
  durationMs: number;
  output?: CapabilityOutput;
  errorType?: string;
}

export interface ConsolidatedEvidence {
  facts: string[];
  inferences: string[];
  recommendations: string[];
  risks: string[];
  missingData: string[];
  confidence: number;
}

export interface OrchestrationResult {
  status: Exclude<OrchestrationExecutionStatus, 'pending' | 'running'>;
  interpretation: string;
  response: string;
  capabilities: string[];
  steps: OrchestrationStepResult[];
  evidence: ConsolidatedEvidence;
  correlationId?: string;
  outcome?: 'ANSWERED' | 'DEGRADED' | 'INSUFFICIENT_DATA';
  operatorInvocations?: OperatorInvocation[];
  evidenceItems?: OrchestrationEvidence[];
  conflicts?: OrchestrationConflict[];
  confidenceBasis?: ConsolidatedConfidenceBasis;
  decision?: Record<string, unknown> | null;
}

export interface ManagerQueryInput {
  message: string;
  projectId?: string | null;
  conversationId?: string | null;
  requestId?: string;
}

export interface ManagerQueryResult {
  correlationId: string;
  status: 'completed' | 'partial' | 'failed';
  outcome: 'ANSWERED' | 'DEGRADED' | 'INSUFFICIENT_DATA';
  intent: ManagerIntent;
  answer: string;
  confidence: number;
  operatorsUsed: OperatorInvocation[];
  evidence: OrchestrationEvidence[];
  conflicts: OrchestrationConflict[];
  missingData: string[];
  decision: Record<string, unknown> | null;
  createdAt: Date;
}

export interface CapabilityExecutionContext {
  request: OrchestrationRequest;
  plan: OrchestrationPlan;
  results: ReadonlyMap<string, OrchestrationStepResult>;
}

export type CapabilityExecutor = (
  context: CapabilityExecutionContext,
) => Promise<CapabilityOutput>;

export interface RegisteredCapability {
  definition: CapabilityDefinition;
  execute: CapabilityExecutor;
}
