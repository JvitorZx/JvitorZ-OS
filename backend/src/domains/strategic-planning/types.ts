export const CONTENT_PLAN_STATUSES = [
  'DRAFT', 'READY', 'NEEDS_RESEARCH', 'BLOCKED', 'IN_PROGRESS',
  'COMPLETED', 'PAUSED', 'CANCELLED',
] as const;
export type ContentPlanStatus = typeof CONTENT_PLAN_STATUSES[number];

export const PLANNING_PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'EXPERIMENTAL'] as const;
export type PlanningPriority = typeof PLANNING_PRIORITIES[number];

export const PLANNING_EFFORTS = ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'] as const;
export type PlanningEffort = typeof PLANNING_EFFORTS[number];

export const PLANNING_HORIZONS = ['TODAY', 'NEXT_3_DAYS', 'NEXT_7_DAYS', 'NEXT_14_DAYS'] as const;
export type PlanningHorizon = typeof PLANNING_HORIZONS[number];

export const EXECUTION_READINESS = ['READY', 'NEEDS_RESEARCH', 'BLOCKED'] as const;
export type ExecutionReadiness = typeof EXECUTION_READINESS[number];

export const EDITORIAL_QUEUE_STATES = ['NEXT', 'LATER', 'WAITING', 'BLOCKED', 'DONE'] as const;
export type EditorialQueueState = typeof EDITORIAL_QUEUE_STATES[number];

export interface PlanningConstraint {
  code: string;
  summary: string;
  blocking: boolean;
}

export interface PlanningEvidence {
  classification: 'fact' | 'inference' | 'recommendation';
  source: string;
  summary: string;
  confidence: number;
  freshness?: string;
}

export interface PlanningRisk {
  code: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  summary: string;
}

export interface PlanningDependency {
  type: 'RESEARCH' | 'EDITORIAL_DECISION' | 'DATA' | 'MANUAL';
  referenceId?: string;
  status: 'READY' | 'PENDING' | 'BLOCKED';
  summary: string;
}

export interface PlanningCandidate {
  key: string;
  title: string;
  candidateType: string;
  sourceDecisionId?: string;
  sourceResearchOpportunityId?: string;
  seriesId?: string;
  decisionCategory?: string;
  opportunityScore: number | null;
  confidence: number;
  researchState?: string;
  freshness?: string;
  trend?: string;
  seriesHealth?: string;
  daysSinceLastEpisode?: number | null;
  effort: PlanningEffort;
  repetitionKey?: string;
  evidence: PlanningEvidence[];
  risks: PlanningRisk[];
  constraints: PlanningConstraint[];
  missingData: string[];
  dependencies: PlanningDependency[];
}

export interface RankedPlanningCandidate extends PlanningCandidate {
  executionScore: number;
  priority: PlanningPriority;
  readiness: ExecutionReadiness;
  queue: EditorialQueueState;
  rank: number;
  experimental: boolean;
  urgent: boolean;
  rationale: string;
}

export interface PlanningGenerationResult {
  horizon: PlanningHorizon;
  status: ContentPlanStatus;
  candidates: RankedPlanningCandidate[];
  balance: {
    proven: number;
    experimental: number;
    policy: string;
  };
  risks: PlanningRisk[];
}
