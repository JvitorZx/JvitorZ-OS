export const CHANNEL_OPERATOR_IDS = ['ctr', 'retention', 'long-form', 'shorts'] as const;
export type ChannelOperatorId = typeof CHANNEL_OPERATOR_IDS[number];
export type ChannelOperatorStatus = 'AVAILABLE' | 'LIMITED' | 'NOT_CONFIGURED';

export interface ChannelOperatorFact {
  label: string;
  value: number | string | null;
  unit?: 'count' | 'percent' | 'seconds' | 'minutes';
  source: 'persisted-youtube-performance';
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
  source: 'persisted-youtube-performance';
  sampleSize: number;
  lastDataAt: Date | null;
}
