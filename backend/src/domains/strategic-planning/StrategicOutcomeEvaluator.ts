import type { Prisma, VideoPerformanceSnapshot } from '@prisma/client';

export const PLANNING_OUTCOME_CLASSIFICATIONS = [
  'AWAITING_DATA',
  'INSUFFICIENT_DATA',
  'BELOW_REFERENCE',
  'WITHIN_REFERENCE',
  'ABOVE_REFERENCE',
  'INCONCLUSIVE',
] as const;

export type PlanningOutcomeClassification = (typeof PLANNING_OUTCOME_CLASSIFICATIONS)[number];

export const PLANNING_OUTCOME_RULES = {
  minimumKnownMetrics: 2,
  minimumComparableVideos: 2,
  neutralBand: 0.1,
  recentHours: 48,
  staleHours: 168,
} as const;

const METRICS = [
  ['views', 'views', 'higher'],
  ['engagedViews', 'engaged views', 'higher'],
  ['impressions', 'impressions', 'higher'],
  ['ctr', 'CTR', 'higher'],
  ['watchTimeMinutes', 'watch time', 'higher'],
  ['averageViewDurationSeconds', 'average view duration', 'higher'],
  ['averageViewPercentage', 'average percentage viewed', 'higher'],
  ['subscribersGained', 'subscribers gained', 'higher'],
  ['subscribersLost', 'subscribers lost', 'lower'],
  ['likes', 'likes', 'higher'],
  ['comments', 'comments', 'higher'],
] as const;

type MetricName = (typeof METRICS)[number][0];

const median = (values: readonly number[]): number | null => {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};

const windowHours = (snapshot: VideoPerformanceSnapshot): number | null => {
  if (!snapshot.periodStart || !snapshot.periodEnd) return null;
  const hours = (snapshot.periodEnd.getTime() - snapshot.periodStart.getTime()) / 3_600_000;
  return hours > 0 ? Math.round(hours) : null;
};

const publicationAgeDays = (snapshot: VideoPerformanceSnapshot): number | null => {
  if (!snapshot.publishedAt || !snapshot.periodEnd) return null;
  return Math.max(0, Math.floor((snapshot.periodEnd.getTime() - snapshot.publishedAt.getTime()) / 86_400_000));
};

const metricFacts = (snapshot: VideoPerformanceSnapshot): Record<string, number | null> =>
  Object.fromEntries(METRICS.map(([metric]) => [metric, snapshot[metric]]));

const freshnessFor = (snapshot: VideoPerformanceSnapshot, now: Date): 'RECENT' | 'AGING' | 'STALE' => {
  const hours = Math.max(0, (now.getTime() - snapshot.collectedAt.getTime()) / 3_600_000);
  return hours <= PLANNING_OUTCOME_RULES.recentHours
    ? 'RECENT'
    : hours <= PLANNING_OUTCOME_RULES.staleHours ? 'AGING' : 'STALE';
};

const dataQualityFor = (snapshot: VideoPerformanceSnapshot): 'HIGH' | 'MEDIUM' | 'LOW' =>
  snapshot.confidence >= 0.75 ? 'HIGH' : snapshot.confidence >= 0.5 ? 'MEDIUM' : 'LOW';

const latestComparableVideos = (
  target: VideoPerformanceSnapshot,
  history: readonly VideoPerformanceSnapshot[],
): VideoPerformanceSnapshot[] => {
  const duration = windowHours(target);
  const age = publicationAgeDays(target);
  if (!target.format || duration === null || age === null) return [];
  const latest = new Map<string, VideoPerformanceSnapshot>();
  for (const snapshot of history) {
    if (snapshot.videoId === target.videoId || snapshot.projectId !== target.projectId || snapshot.format !== target.format) continue;
    if (windowHours(snapshot) !== duration || publicationAgeDays(snapshot) !== age) continue;
    const previous = latest.get(snapshot.videoId);
    if (!previous || previous.collectedAt < snapshot.collectedAt) latest.set(snapshot.videoId, snapshot);
  }
  return [...latest.values()].sort((left, right) => left.videoId.localeCompare(right.videoId));
};

export interface StrategicOutcomeEvaluation {
  classification: PlanningOutcomeClassification;
  confidence: number;
  freshness: 'RECENT' | 'AGING' | 'STALE';
  dataQuality: 'HIGH' | 'MEDIUM' | 'LOW';
  metrics: Prisma.InputJsonValue;
  benchmark: Prisma.InputJsonValue;
  comparison: Prisma.InputJsonValue;
  evidence: Prisma.InputJsonValue;
  limitations: Prisma.InputJsonValue;
  missingData: Prisma.InputJsonValue;
}

export const evaluateStrategicOutcome = (
  snapshot: VideoPerformanceSnapshot,
  history: readonly VideoPerformanceSnapshot[],
  now = new Date(),
): StrategicOutcomeEvaluation => {
  const freshness = freshnessFor(snapshot, now);
  const dataQuality = dataQualityFor(snapshot);
  const facts = metricFacts(snapshot);
  const missingData = METRICS.filter(([metric]) => facts[metric] === null).map(([, label]) => label);
  const knownMetrics = METRICS.filter(([metric]) => facts[metric] !== null);
  const comparable = latestComparableVideos(snapshot, history);
  const limitations: string[] = [];
  if (!snapshot.format) limitations.push('Formato do video ausente; Shorts e long-form nao podem ser comparados com seguranca.');
  if (windowHours(snapshot) === null) limitations.push('Janela de observacao ausente ou invalida.');
  if (publicationAgeDays(snapshot) === null) limitations.push('Idade de publicacao indisponivel para alinhar referencias.');
  if (freshness === 'STALE') limitations.push('Snapshot stale; a confianca foi reduzida.');
  if (dataQuality === 'LOW') limitations.push('Qualidade da fonte baixa; a confianca foi reduzida.');

  const commonBenchmark = {
    strategy: 'median_of_same_format_window_and_publication_age',
    format: snapshot.format,
    windowHours: windowHours(snapshot),
    publicationAgeDays: publicationAgeDays(snapshot),
    comparableVideos: comparable.length,
    minimumComparableVideos: PLANNING_OUTCOME_RULES.minimumComparableVideos,
    neutralBand: PLANNING_OUTCOME_RULES.neutralBand,
  };
  const baseEvidence = [{
    classification: 'fact',
    source: `performance-snapshot:${snapshot.id}`,
    summary: 'Metricas observadas no snapshot persistido do video associado.',
  }];

  if (knownMetrics.length < PLANNING_OUTCOME_RULES.minimumKnownMetrics) {
    return {
      classification: 'AWAITING_DATA', confidence: 0, freshness, dataQuality,
      metrics: facts, benchmark: commonBenchmark, comparison: [], evidence: baseEvidence,
      limitations: [...limitations, 'Menos de duas metricas observadas estao disponiveis.'], missingData,
    };
  }
  if (comparable.length < PLANNING_OUTCOME_RULES.minimumComparableVideos) {
    return {
      classification: 'INSUFFICIENT_DATA', confidence: Math.min(0.3, snapshot.confidence * 0.3), freshness, dataQuality,
      metrics: facts, benchmark: commonBenchmark, comparison: [], evidence: baseEvidence,
      limitations: [...limitations, 'Nao ha ao menos dois videos com formato, janela e idade de publicacao compativeis.'], missingData,
    };
  }

  const comparisons = knownMetrics.flatMap(([metric, label, direction]) => {
    const values = comparable.flatMap((candidate) => {
      const value = candidate[metric];
      return typeof value === 'number' && Number.isFinite(value) ? [value] : [];
    });
    const reference = median(values);
    const value = snapshot[metric];
    if (reference === null || value === null || values.length < PLANNING_OUTCOME_RULES.minimumComparableVideos) return [];
    const ratio = reference === 0 ? null : value / reference;
    let result: 'above' | 'within' | 'below' = 'within';
    if (ratio !== null && ratio > 1 + PLANNING_OUTCOME_RULES.neutralBand) result = direction === 'higher' ? 'above' : 'below';
    if (ratio !== null && ratio < 1 - PLANNING_OUTCOME_RULES.neutralBand) result = direction === 'higher' ? 'below' : 'above';
    return [{ metric, label, value, benchmarkMedian: reference, sampleSize: values.length, ratio, result }];
  });
  if (comparisons.length < PLANNING_OUTCOME_RULES.minimumKnownMetrics) {
    return {
      classification: 'INSUFFICIENT_DATA', confidence: Math.min(0.35, snapshot.confidence * 0.35), freshness, dataQuality,
      metrics: facts, benchmark: commonBenchmark, comparison: comparisons, evidence: baseEvidence,
      limitations: [...limitations, 'As referencias nao possuem metricas compativeis suficientes.'], missingData,
    };
  }

  const above = comparisons.filter(({ result }) => result === 'above').length;
  const below = comparisons.filter(({ result }) => result === 'below').length;
  const classification: PlanningOutcomeClassification = above > 0 && below > 0
    ? 'INCONCLUSIVE'
    : above >= 2 ? 'ABOVE_REFERENCE'
      : below >= 2 ? 'BELOW_REFERENCE' : 'WITHIN_REFERENCE';
  if (classification === 'INCONCLUSIVE') limitations.push('Metricas apontam em direcoes diferentes; nao ha conclusao unica defensavel.');
  const freshnessFactor = freshness === 'RECENT' ? 1 : freshness === 'AGING' ? 0.8 : 0.55;
  const qualityFactor = dataQuality === 'HIGH' ? 1 : dataQuality === 'MEDIUM' ? 0.8 : 0.55;
  const confidence = Math.min(0.95, snapshot.confidence * freshnessFactor * qualityFactor
    * Math.min(1, comparisons.length / 5) * Math.min(1, comparable.length / 5));
  const statement = classification === 'ABOVE_REFERENCE'
    ? 'O video associado apresentou desempenho acima da referencia comparavel nesta janela.'
    : classification === 'BELOW_REFERENCE'
      ? 'O video associado apresentou desempenho abaixo da referencia comparavel nesta janela.'
      : classification === 'WITHIN_REFERENCE'
        ? 'O video associado apresentou desempenho dentro da referencia comparavel nesta janela.'
        : 'O video associado apresentou sinais mistos nesta janela; os dados nao sustentam uma direcao unica.';
  return {
    classification, confidence, freshness, dataQuality, metrics: facts,
    benchmark: { ...commonBenchmark, metrics: Object.fromEntries(comparisons.map(({ metric, benchmarkMedian, sampleSize }) => [metric, { median: benchmarkMedian, sampleSize }])) },
    comparison: comparisons,
    evidence: [...baseEvidence, { classification: 'inference', source: 'strategic-outcome-evaluator', summary: statement }],
    limitations: [...limitations, 'Comparacao observacional nao demonstra causalidade entre a recomendacao e o resultado.'],
    missingData,
  };
};
