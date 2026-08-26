export type OrchestrationIntent =
  | 'next_content'
  | 'outcome_status'
  | 'channel_status'
  | 'series_viability'
  | 'controlled_sync_review'
  | 'general_operations';

export type CapabilityAccess = 'read' | 'write' | 'external_side_effect';
export type CapabilitySideEffect = 'READ_ONLY' | 'INTERNAL_WRITE' | 'EXTERNAL_READ' | 'EXTERNAL_WRITE';
export type OrchestrationRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type PlanReviewState = 'draft' | 'review_required' | 'approved' | 'rejected' | 'expired' | 'executed';
export type OrchestrationExecutionStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed';
export type OrchestrationStepStatus = 'pending' | 'completed' | 'skipped' | 'failed';

export interface OrchestrationRequest {
  intent: string;
  projectId?: string | null;
  conversationId?: string | null;
  idempotencyKey?: string;
  confirmExternalSideEffect?: boolean;
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
  availability: 'available';
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
