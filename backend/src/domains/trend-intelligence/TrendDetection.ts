import type { DetectedTrend, TrendClassification, TrendQuality, TrendSubjectType } from './types';
import type { ComparableWindowPair } from './TrendWindowPolicy';

export const TREND_POLICY = {
  minimumSamplesPerWindow: 2,
  stableRelativeBand: 0.08,
  meaningfulRelativeChange: 0.15,
  directionalConsistency: 0.67,
  volatileCoefficientOfVariation: 0.60,
  confidenceWeights: { volume: 0.35, comparablePeriods: 0.20, quality: 0.25, consistency: 0.20 },
} as const;

export interface TrendObservation {
  id: string;
  videoId?: string;
  value: number;
  occurredAt: Date;
}

const rounded = (value: number, precision = 4): number => Number(value.toFixed(precision));
const mean = (values: readonly number[]): number | null => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const coefficientOfVariation = (values: readonly number[]): number => {
  const average = mean(values);
  if (average === null || average === 0 || values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.abs(average);
};

const qualityFactor = (quality: TrendQuality): number => {
  const state = { GOOD: 1, PARTIAL: 0.7, STALE: 0.45, MISSING: 0, INCONSISTENT: 0.25 }[quality.state];
  return state * quality.completeness * quality.consistency;
};

export const detectTrend = (input: {
  subject: string;
  subjectType: TrendSubjectType;
  metric: string;
  windows: ComparableWindowPair;
  current: readonly TrendObservation[];
  previous: readonly TrendObservation[];
  quality: TrendQuality;
  detectedAt: Date;
  aggregate?: 'sum' | 'mean';
}): DetectedTrend => {
  const currentValues = input.current.map(({ value }) => value).filter(Number.isFinite);
  const previousValues = input.previous.map(({ value }) => value).filter(Number.isFinite);
  const aggregate = (values: readonly number[]) => input.aggregate === 'sum'
    ? values.reduce((sum, value) => sum + value, 0)
    : mean(values);
  const currentValue = aggregate(currentValues);
  const previousValue = aggregate(previousValues);
  const sampleSize = currentValues.length + previousValues.length;
  let classification: TrendClassification = 'INSUFFICIENT_DATA';
  let delta: number | null = null;
  let consistency = 0;
  const reasons: string[] = [];

  if (
    currentValues.length < TREND_POLICY.minimumSamplesPerWindow
    || previousValues.length < TREND_POLICY.minimumSamplesPerWindow
    || currentValue === null || previousValue === null || previousValue === 0
  ) {
    reasons.push(`São necessárias ao menos ${TREND_POLICY.minimumSamplesPerWindow} observações válidas em cada janela equivalente.`);
  } else {
    delta = rounded((currentValue - previousValue) / Math.abs(previousValue));
    const direction = Math.sign(delta);
    const previousObservationAverage = mean(previousValues) ?? previousValue;
    consistency = currentValues.filter((value) => Math.sign(value - previousObservationAverage) === direction).length / currentValues.length;
    const dispersion = coefficientOfVariation([...currentValues, ...previousValues]);
    if (dispersion >= TREND_POLICY.volatileCoefficientOfVariation && consistency < TREND_POLICY.directionalConsistency) {
      classification = 'VOLATILE';
      reasons.push('A dispersão é alta e as observações não mantêm direção consistente.');
    } else if (Math.abs(delta) <= TREND_POLICY.stableRelativeBand) {
      classification = 'STABLE';
      reasons.push('A variação permaneceu dentro da faixa estável documentada de 8%.');
    } else if (delta >= TREND_POLICY.meaningfulRelativeChange && consistency >= TREND_POLICY.directionalConsistency) {
      classification = 'RISING';
      reasons.push('A alta superou 15% com direção consistente em pelo menos dois terços da janela atual.');
    } else if (delta <= -TREND_POLICY.meaningfulRelativeChange && consistency >= TREND_POLICY.directionalConsistency) {
      classification = 'DECLINING';
      reasons.push('A queda superou 15% com direção consistente em pelo menos dois terços da janela atual.');
    } else {
      classification = 'STABLE';
      reasons.push('A mudança não combinou magnitude e consistência suficientes para caracterizar tendência.');
    }
  }

  const volume = Math.min(1, sampleSize / 8);
  const comparablePeriods = currentValues.length >= 2 && previousValues.length >= 2 ? 1 : 0;
  const confidence = classification === 'INSUFFICIENT_DATA' ? Math.min(0.3, rounded(volume * 0.3)) : rounded(
    volume * TREND_POLICY.confidenceWeights.volume
    + comparablePeriods * TREND_POLICY.confidenceWeights.comparablePeriods
    + qualityFactor(input.quality) * TREND_POLICY.confidenceWeights.quality
    + consistency * TREND_POLICY.confidenceWeights.consistency,
  );
  reasons.push(`Confiança combina volume (35%), janelas comparáveis (20%), qualidade (25%) e consistência (20%).`);

  const window = (value: number | null, sample: number, definition: ComparableWindowPair['current']) => ({
    label: definition.label,
    start: definition.start.toISOString(),
    end: definition.end.toISOString(),
    value: value === null ? null : rounded(value),
    sampleSize: sample,
  });
  return {
    subject: input.subject,
    subjectType: input.subjectType,
    metric: input.metric,
    classification,
    currentWindow: window(currentValue, currentValues.length, input.windows.current),
    previousWindow: window(previousValue, previousValues.length, input.windows.previous),
    delta,
    sampleSize,
    confidence,
    evidence: [...input.current, ...input.previous].slice(0, 24).map((item) => ({
      snapshotId: item.id,
      ...(item.videoId ? { videoId: item.videoId } : {}),
      value: item.value,
      periodAt: item.occurredAt.toISOString(),
    })),
    quality: input.quality,
    reasons,
    detectedAt: input.detectedAt,
  };
};
