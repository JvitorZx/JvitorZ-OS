import { createHash } from 'node:crypto';
import { PLANNING_OUTCOME_RULES } from '../strategic-planning';

export const STRATEGIC_LEARNING_STATUSES = ['WEAK', 'EMERGING', 'SUPPORTED', 'STALE', 'CONTRADICTED'] as const;
export const STRATEGIC_LEARNING_DIMENSIONS = ['FORMAT', 'SERIES', 'GAME', 'CONTENT_TYPE', 'PRIORITY', 'PUBLICATION_WEEKDAY'] as const;
export type StrategicLearningStatus = typeof STRATEGIC_LEARNING_STATUSES[number];
export type StrategicLearningDimension = typeof STRATEGIC_LEARNING_DIMENSIONS[number];
export type StrategicLearningStance = 'FAVORABLE' | 'NEUTRAL' | 'CONTRARY';

// Public, deterministic rules. They are product constraints, not learned causality thresholds.
export const STRATEGIC_LEARNING_RULES = Object.freeze({
  emergingMinimumObservations: 2,
  supportedMinimumObservations: 4,
  emergingDominance: 2 / 3,
  supportedDominance: 0.75,
  contradictionMinimumPerSide: 2,
  fullSampleSize: 4,
  staleHours: PLANNING_OUTCOME_RULES.staleHours,
});

export interface StrategicLearningObservation {
  outcomeId: string;
  videoId: string;
  observedAt: Date;
  confidence: number;
  freshness: string;
  classification: string;
  dimension: StrategicLearningDimension;
  subject: string;
  comparisonContext: Record<string, unknown>;
  benchmark: unknown;
}

export interface StrategicLearningAnalysis {
  key: string;
  projectId: string | null;
  dimension: StrategicLearningDimension;
  subject: string;
  comparisonContext: Record<string, unknown>;
  description: string;
  direction: StrategicLearningStance | 'MIXED';
  status: StrategicLearningStatus;
  observationCount: number;
  favorableCount: number;
  neutralCount: number;
  contraryCount: number;
  confidence: number;
  freshness: 'RECENT' | 'AGING' | 'STALE';
  benchmark: unknown;
  limitations: string[];
  analysisFingerprint: string;
  firstObservedAt: Date;
  lastObservedAt: Date;
  evidence: Array<{ outcomeId: string; stance: StrategicLearningStance; summary: string }>;
}

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
};

const hash = (value: unknown): string => createHash('sha256').update(stable(value)).digest('hex');
const round = (value: number): number => Math.round(value * 10_000) / 10_000;
const stanceFor = (classification: string): StrategicLearningStance | null => ({
  ABOVE_REFERENCE: 'FAVORABLE', WITHIN_REFERENCE: 'NEUTRAL', BELOW_REFERENCE: 'CONTRARY',
} as Record<string, StrategicLearningStance>)[classification] ?? null;

export const analyzeStrategicLearning = (
  projectId: string | null,
  observations: readonly StrategicLearningObservation[],
  now = new Date(),
): StrategicLearningAnalysis | null => {
  const eligible = observations.flatMap((entry) => stanceFor(entry.classification) ? [{ ...entry, stance: stanceFor(entry.classification) as StrategicLearningStance }] : []);
  if (!eligible.length) return null;
  const ordered = [...eligible].sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime() || left.outcomeId.localeCompare(right.outcomeId));
  const sample = new Map<string, typeof ordered[number]>();
  for (const entry of ordered) sample.set(entry.videoId, entry);
  const evidence = [...sample.values()];
  const favorableCount = evidence.filter(({ stance }) => stance === 'FAVORABLE').length;
  const neutralCount = evidence.filter(({ stance }) => stance === 'NEUTRAL').length;
  const contraryCount = evidence.filter(({ stance }) => stance === 'CONTRARY').length;
  const observationCount = evidence.length;
  const latest = evidence.reduce((left, right) => left.observedAt > right.observedAt ? left : right);
  const oldest = evidence.reduce((left, right) => left.observedAt < right.observedAt ? left : right);
  const hoursOld = Math.max(0, (now.getTime() - latest.observedAt.getTime()) / 3_600_000);
  const freshness = hoursOld > STRATEGIC_LEARNING_RULES.staleHours ? 'STALE'
    : hoursOld > PLANNING_OUTCOME_RULES.recentHours ? 'AGING' : 'RECENT';
  const dominant = Math.max(favorableCount, neutralCount, contraryCount);
  const leaders = [['FAVORABLE', favorableCount], ['NEUTRAL', neutralCount], ['CONTRARY', contraryCount]]
    .filter(([, count]) => count === dominant);
  const direction = (leaders.length === 1 ? leaders[0][0] : 'MIXED') as StrategicLearningStance | 'MIXED';
  const dominance = dominant / observationCount;
  const contradictory = favorableCount >= STRATEGIC_LEARNING_RULES.contradictionMinimumPerSide
    && contraryCount >= STRATEGIC_LEARNING_RULES.contradictionMinimumPerSide;
  let status: StrategicLearningStatus = 'WEAK';
  if (contradictory) status = 'CONTRADICTED';
  else if (freshness === 'STALE') status = 'STALE';
  else if (observationCount >= STRATEGIC_LEARNING_RULES.supportedMinimumObservations
    && dominance >= STRATEGIC_LEARNING_RULES.supportedDominance) status = 'SUPPORTED';
  else if (observationCount >= STRATEGIC_LEARNING_RULES.emergingMinimumObservations
    && dominance >= STRATEGIC_LEARNING_RULES.emergingDominance) status = 'EMERGING';
  const averageConfidence = evidence.reduce((total, entry) => total + entry.confidence, 0) / observationCount;
  const sampleFactor = Math.min(1, observationCount / STRATEGIC_LEARNING_RULES.fullSampleSize);
  const freshnessFactor = freshness === 'RECENT' ? 1 : freshness === 'AGING' ? 0.8 : 0.55;
  const confidence = round(Math.min(0.95, averageConfidence * sampleFactor * dominance * freshnessFactor));
  const subject = evidence[0].subject;
  const dimension = evidence[0].dimension;
  const comparisonContext = evidence[0].comparisonContext;
  const limitations = [
    ...(observationCount < STRATEGIC_LEARNING_RULES.supportedMinimumObservations ? ['Amostra pequena; o aprendizado ainda nao e uma regra sustentada.'] : []),
    ...(contradictory ? ['Ha evidencias favoraveis e contrarias; a interpretacao mudou e requer cautela.'] : []),
    ...(freshness === 'STALE' ? ['As evidencias mais recentes estao stale segundo a janela publica do outcome.'] : []),
    'Associacao observada nao demonstra causalidade nem altera automaticamente o ranking.',
  ];
  const description = `Em ${observationCount} videos comparaveis de ${dimension.toLowerCase()} "${subject}", ${favorableCount} ficaram acima, ${neutralCount} dentro e ${contraryCount} abaixo da referencia correspondente.`;
  const payload = { projectId, dimension, subject, comparisonContext, direction, status, favorableCount, neutralCount, contraryCount,
    confidence, freshness, outcomes: evidence.map(({ outcomeId, stance }) => ({ outcomeId, stance })) };
  return {
    key: hash({ projectId, dimension, subject, comparisonContext }), projectId, dimension, subject, comparisonContext,
    description, direction, status, observationCount, favorableCount, neutralCount, contraryCount, confidence, freshness,
    benchmark: latest.benchmark, limitations, analysisFingerprint: hash(payload), firstObservedAt: oldest.observedAt,
    lastObservedAt: latest.observedAt, evidence: evidence.map(({ outcomeId, stance }) => ({ outcomeId, stance,
      summary: `Outcome ${outcomeId}: ${stance.toLowerCase()} em relacao ao benchmark comparavel persistido.` })),
  };
};
