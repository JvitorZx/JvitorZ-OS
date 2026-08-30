export const EXPERIMENT_STATUSES = ['DRAFT', 'READY', 'RUNNING', 'WAITING_FOR_DATA', 'COMPLETED', 'INCONCLUSIVE', 'CANCELLED'] as const;
export const EXPERIMENT_RESULT_CLASSIFICATIONS = ['SUPPORTS_HYPOTHESIS', 'CONTRADICTS_HYPOTHESIS', 'MIXED_EVIDENCE', 'INSUFFICIENT_EVIDENCE'] as const;
export const EXPERIMENT_METRICS = ['views', 'engagedViews', 'impressions', 'ctr', 'watchTimeMinutes', 'averageViewDurationSeconds', 'averageViewPercentage', 'subscribersGained', 'subscribersLost', 'likes', 'comments'] as const;
export const EXPERIMENT_METRIC_DIRECTIONS = ['HIGHER_BETTER', 'LOWER_BETTER'] as const;
export type ExperimentStatus = typeof EXPERIMENT_STATUSES[number];
export type ExperimentResultClassification = typeof EXPERIMENT_RESULT_CLASSIFICATIONS[number];
export type ExperimentMetricName = typeof EXPERIMENT_METRICS[number];
export type ExperimentMetricDirection = typeof EXPERIMENT_METRIC_DIRECTIONS[number];

export interface ExperimentAnalysisObservation {
  id: string;
  variantKey: string;
  outcomeId: string;
  videoId: string;
  observedAt: Date;
  freshness: string;
  dataQuality: string;
  comparisonContext: Record<string, unknown>;
  metrics: Record<string, unknown>;
  outcomeConfidence: number;
}

export interface ExperimentAnalysisInput {
  experimentId: string;
  hypothesis: string;
  expectedVariantKey: string;
  primaryMetric: ExperimentMetricName;
  direction: ExperimentMetricDirection;
  variants: ReadonlyArray<{ key: string; label: string }>;
  observations: readonly ExperimentAnalysisObservation[];
}

export interface ExperimentAnalysis {
  classification: ExperimentResultClassification;
  status: Extract<ExperimentStatus, 'WAITING_FOR_DATA' | 'COMPLETED' | 'INCONCLUSIVE'>;
  summary: string;
  confidence: number;
  benchmark: Record<string, unknown>;
  limitations: string[];
  analysisFingerprint: string;
  evidence: Array<{ observationId: string; stance: 'SUPPORTS' | 'CONTRADICTS' | 'NEUTRAL' | 'LIMITATION'; summary: string }>;
}

export interface CreateExperimentInput {
  projectId?: string | null;
  sourceLearningId?: string | null;
  title: string;
  description?: string | null;
  context?: Record<string, unknown>;
  hypothesis: string;
  priorEvidence?: unknown[];
  expectedVariantKey: string;
  primaryMetric: ExperimentMetricName;
  secondaryMetrics?: ExperimentMetricName[];
  metricDirection?: ExperimentMetricDirection;
  risk?: string | null;
  comparisonCriterion?: Record<string, unknown>;
  variants: Array<{ key: string; label: string; description?: string | null; plannedItemId?: string | null; executionEventId?: string | null }>;
  constraints?: Array<{ code: string; summary: string; blocking: boolean }>;
}
