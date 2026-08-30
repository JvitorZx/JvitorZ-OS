export const EDITORIAL_DECISION_CATEGORIES = [
  'PRIORITIZE',
  'CONTINUE',
  'TEST',
  'HOLD',
  'PAUSE',
  'REEVALUATE',
  'INSUFFICIENT_DATA',
] as const;

export type EditorialDecisionCategory = typeof EDITORIAL_DECISION_CATEGORIES[number];

export const EDITORIAL_CANDIDATE_TYPES = ['IDEA', 'SERIES', 'GAME', 'FORMAT', 'TOPIC'] as const;
export type EditorialCandidateType = typeof EDITORIAL_CANDIDATE_TYPES[number];

export const OPPORTUNITY_FACTOR_IDS = [
  'HISTORICAL_PERFORMANCE',
  'TREND',
  'SERIES_HEALTH',
  'FORMAT_FIT',
  'RETENTION',
  'CTR',
  'WATCH_TIME',
  'SUBSCRIBER_GAIN',
  'AUDIENCE_RESPONSE',
  'EDITORIAL_FIT',
] as const;

export type OpportunityFactorId = typeof OPPORTUNITY_FACTOR_IDS[number];
export type DecisionEvidenceDirection = 'favorable' | 'contrary' | 'neutral';
export type DecisionEvidenceClassification = 'fact' | 'inference';
export type DecisionRiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface EditorialCandidate {
  key: string;
  label: string;
  type: EditorialCandidateType;
  ideaId?: string;
  game?: string;
  topic?: string;
  format?: string;
  seriesId?: string;
}

export interface DecisionEvidence {
  direction: DecisionEvidenceDirection;
  classification: DecisionEvidenceClassification;
  source: string;
  summary: string;
  confidence: number;
}

export interface DecisionRisk {
  code: string;
  severity: DecisionRiskSeverity;
  summary: string;
  source?: string;
}

export interface DecisionConstraint {
  code: string;
  summary: string;
}

export interface OpportunityFactor {
  id: OpportunityFactorId;
  value: number | null;
  confidence: number;
  quality: string;
  source: string;
  summary: string;
  classification: DecisionEvidenceClassification;
}

export interface OpportunityScoreComponent extends OpportunityFactor {
  weight: number;
  effectiveWeight: number;
  qualityMultiplier: number;
}

export interface OpportunityScore {
  value: number;
  confidence: number;
  coverage: number;
  category: EditorialDecisionCategory;
  components: OpportunityScoreComponent[];
  favorableEvidence: DecisionEvidence[];
  contraryEvidence: DecisionEvidence[];
  risks: DecisionRisk[];
  constraints: DecisionConstraint[];
  missingData: OpportunityFactorId[];
  rationale: string;
  disclaimer: string;
}

export interface RankedEditorialCandidate {
  rank: number;
  candidate: EditorialCandidate;
  opportunity: OpportunityScore;
}
