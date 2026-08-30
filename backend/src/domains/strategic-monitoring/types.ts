export const STRATEGIC_SIGNAL_TYPES = [
  'TREND_DECLINING',
  'TREND_RISING',
  'DATA_STALE',
  'DATA_MISSING',
  'DATA_QUALITY_DEGRADED',
  'SERIES_DECLINING',
  'SERIES_DORMANT',
  'OPPORTUNITY_EXPIRING',
  'OPPORTUNITY_STALE',
  'PLANNING_BLOCKED',
  'EXPERIMENT_INCONCLUSIVE',
  'LEARNING_CONTRADICTED',
  'LEARNING_STALE',
] as const;

export const SIGNAL_SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const SIGNAL_STATES = ['NEW', 'ACKNOWLEDGED', 'RESOLVED', 'STALE', 'DISMISSED'] as const;

export type StrategicSignalType = typeof STRATEGIC_SIGNAL_TYPES[number];
export type SignalSeverity = typeof SIGNAL_SEVERITIES[number];
export type SignalState = typeof SIGNAL_STATES[number];

export interface MonitoringFact {
  type: StrategicSignalType;
  source: string;
  sourceId: string;
  subject: string;
  stateValue: string;
  summary: string;
  impact: string;
  confidence: number;
  limitations: string[];
  evidence: string[];
  observedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface MonitoringRuleDefinition {
  code: string;
  signalType: StrategicSignalType;
  defaultSeverity: SignalSeverity;
  cooldownHours: number;
  description: string;
}

export interface StrategicSignalCandidate extends MonitoringFact {
  logicalKey: string;
  fingerprint: string;
  severity: SignalSeverity;
  ruleCode: string;
}

export interface MonitoringSourceResult {
  facts: MonitoringFact[];
  evaluatedSources: string[];
  sourceState: Record<string, 'AVAILABLE' | 'DEGRADED'>;
}

export interface StrategicMonitoringSource {
  collect(projectId: string | null, now: Date): Promise<MonitoringSourceResult>;
}
