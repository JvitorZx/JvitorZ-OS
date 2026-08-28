export const CHANNEL_OPERATOR_IDS = ['ctr', 'retention', 'long-form', 'shorts'] as const;
export type ChannelOperatorId = typeof CHANNEL_OPERATOR_IDS[number];
export type ChannelOperatorStatus = 'AVAILABLE' | 'LIMITED' | 'NOT_CONFIGURED';

export interface ChannelOperatorFact {
  label: string;
  value: number | string | null;
  unit?: 'count' | 'percent' | 'seconds' | 'minutes';
  source: 'persisted-youtube-performance' | 'youtube-reporting-reach' | 'youtube-analytics-audience';
}
export interface ChannelOperatorSignal {
  classification: 'fact' | 'inference';
  direction: 'positive' | 'negative' | 'neutral';
  summary: string;
  videoId?: string;
  snapshotId?: string;
}

export interface ChannelOperatorEvidence {
  snapshotId: string;
  videoId: string;
  title: string;
  collectedAt: Date;
  metrics: Record<string, number | null>;
  source?: 'persisted-youtube-performance' | 'youtube-reporting-reach' | 'youtube-analytics-audience';
  periodStart?: Date;
  periodEnd?: Date;
}

export interface ChannelOperatorBaseline {
  scope: string;
  median: number | null;
  sampleSize: number;
}

export interface ChannelOperatorAnalysis {
  id: ChannelOperatorId;
  name: string;
  responsibility: string;
  status: ChannelOperatorStatus;
  facts: ChannelOperatorFact[];
  signals: ChannelOperatorSignal[];
  insights: string[];
  recommendations: string[];
  missingData: string[];
  confidence: number;
  evidence: ChannelOperatorEvidence[];
  source: 'persisted-youtube-performance' | 'youtube-reporting-reach' | 'youtube-analytics-audience';
  sampleSize: number;
  lastDataAt: Date | null;
  quality?: {
    state: string;
    freshness: string;
    completeness: number;
    consistency: number;
    sourceReliability: number;
    reasons: Array<{ code: string; message: string; severity: string }>;
  };
  baselines?: ChannelOperatorBaseline[];
}
