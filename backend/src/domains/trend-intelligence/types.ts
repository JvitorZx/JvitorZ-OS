export const TREND_CLASSIFICATIONS = [
  'RISING', 'DECLINING', 'STABLE', 'VOLATILE', 'INSUFFICIENT_DATA',
] as const;
export type TrendClassification = typeof TREND_CLASSIFICATIONS[number];

export const TREND_SUBJECT_TYPES = [
  'CHANNEL', 'FORMAT', 'SERIES', 'GAME', 'TOPIC', 'TRAFFIC_SOURCE', 'AUDIENCE_SEGMENT',
] as const;
export type TrendSubjectType = typeof TREND_SUBJECT_TYPES[number];

export interface TrendWindowSummary {
  start: string;
  end: string;
  label: string;
  value: number | null;
  sampleSize: number;
}

export interface TrendQuality {
  state: 'GOOD' | 'PARTIAL' | 'STALE' | 'MISSING' | 'INCONSISTENT';
  completeness: number;
  consistency: number;
  freshness: string;
  reasons: string[];
}

export interface DetectedTrend {
  subject: string;
  subjectType: TrendSubjectType;
  metric: string;
  classification: TrendClassification;
  currentWindow: TrendWindowSummary;
  previousWindow: TrendWindowSummary;
  delta: number | null;
  sampleSize: number;
  confidence: number;
  evidence: Array<{ snapshotId: string; videoId?: string; value: number; periodAt: string }>;
  quality: TrendQuality;
  reasons: string[];
  detectedAt: Date;
}

export const SERIES_HEALTH_STATES = [
  'STRONG', 'HEALTHY', 'DECLINING', 'VOLATILE', 'DORMANT', 'INSUFFICIENT_DATA',
] as const;
export type SeriesHealthState = typeof SERIES_HEALTH_STATES[number];

export interface SeriesHealthAnalysis {
  seriesId: string;
  name: string;
  health: SeriesHealthState;
  trend: TrendClassification;
  sampleSize: number;
  confidence: number;
  evidence: Array<{ snapshotId: string; videoId: string; title: string; views: number | null; collectedAt: Date }>;
  reasons: string[];
  missingData: string[];
  metrics: Record<string, number | null>;
  outcomes: { sampleSize: number; classifications: Record<string, number> };
  lastPublishedAt: Date | null;
}

export interface ContentPatternAnalysis {
  subject: string;
  patternType: 'GAME' | 'TOPIC' | 'FORMAT' | 'SERIES' | 'TRAFFIC_MIX' | 'AUDIENCE_SEGMENT';
  classification: 'STRONG' | 'NEUTRAL' | 'WEAK' | 'INSUFFICIENT_DATA';
  association: string;
  hypothesis: string;
  sampleSize: number;
  confidence: number;
  evidence: Array<{ snapshotId: string; videoId?: string; metric: string; value: number }>;
  quality: TrendQuality;
  detectedAt: Date;
}
