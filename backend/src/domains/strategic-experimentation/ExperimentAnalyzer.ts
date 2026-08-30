import { createHash } from 'node:crypto';
import type { ExperimentAnalysis, ExperimentAnalysisInput, ExperimentAnalysisObservation } from './types';

// Public product rules. Confidence is evidence quality, never probability of success.
export const EXPERIMENT_ANALYSIS_RULES = Object.freeze({
  minimumObservationsPerVariant: 2,
  fullSamplePerVariant: 4,
  neutralRelativeDifference: 0.1,
  staleFreshnessValues: ['STALE', 'MISSING'],
  weakQualityValues: ['LOW', 'MISSING', 'ERROR'],
});

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
};
const hash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');
const round = (value: number) => Math.round(value * 10_000) / 10_000;
const numeric = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const median = (values: number[]): number => {
  const ordered = [...values].sort((a, b) => a - b); const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};
const comparableKey = (entry: ExperimentAnalysisObservation) => stable({
  format: entry.comparisonContext.format ?? null,
  windowHours: entry.comparisonContext.windowHours ?? null,
  publicationAgeDays: entry.comparisonContext.publicationAgeDays ?? null,
  strategy: entry.comparisonContext.strategy ?? null,
});

export const analyzeStrategicExperiment = (input: ExperimentAnalysisInput): ExperimentAnalysis => {
  const limitations = ['Os resultados observados mostram associacao, nao causalidade nem previsao de performance.'];
  const variants = [...new Set(input.variants.map(({ key }) => key))];
  const expected = input.variants.find(({ key }) => key === input.expectedVariantKey);
  const comparator = input.variants.find(({ key }) => key !== input.expectedVariantKey);
  const evidence: ExperimentAnalysis['evidence'] = [];
  const usable = input.observations.filter((entry) => {
    const value = numeric(entry.metrics[input.primaryMetric]);
    if (value === null) { limitations.push(`Outcome ${entry.outcomeId} nao possui a metrica primaria ${input.primaryMetric}.`); return false; }
    if (EXPERIMENT_ANALYSIS_RULES.staleFreshnessValues.includes(entry.freshness)) { limitations.push(`Outcome ${entry.outcomeId} possui dados stale ou ausentes.`); return false; }
    if (EXPERIMENT_ANALYSIS_RULES.weakQualityValues.includes(entry.dataQuality)) { limitations.push(`Outcome ${entry.outcomeId} possui qualidade insuficiente.`); return false; }
    return true;
  });
  const contexts = new Set(usable.map(comparableKey));
  const byVariant = new Map(variants.map((key) => [key, usable.filter((entry) => entry.variantKey === key)]));
  const enough = variants.length === 2 && expected && comparator
    && variants.every((key) => (byVariant.get(key)?.length ?? 0) >= EXPERIMENT_ANALYSIS_RULES.minimumObservationsPerVariant);
  if (variants.length !== 2) limitations.push('A analise controlada inicial exige exatamente duas variantes.');
  if (contexts.size > 1) limitations.push('As observacoes possuem formato ou janela de comparacao incompativeis.');
  if (!enough || contexts.size !== 1) {
    const summary = 'Ainda nao existem observacoes comparaveis suficientes para avaliar a hipotese.';
    return { classification: 'INSUFFICIENT_EVIDENCE', status: 'WAITING_FOR_DATA', summary, confidence: 0,
      benchmark: { metric: input.primaryMetric, direction: input.direction, minimumPerVariant: EXPERIMENT_ANALYSIS_RULES.minimumObservationsPerVariant },
      limitations: [...new Set(limitations)], analysisFingerprint: hash({ input, classification: 'INSUFFICIENT_EVIDENCE' }), evidence };
  }
  const expectedRows = byVariant.get(expected.key) ?? []; const comparatorRows = byVariant.get(comparator.key) ?? [];
  const expectedMedian = median(expectedRows.map((entry) => numeric(entry.metrics[input.primaryMetric]) as number));
  const comparatorMedian = median(comparatorRows.map((entry) => numeric(entry.metrics[input.primaryMetric]) as number));
  const denominator = Math.max(Math.abs(comparatorMedian), Number.EPSILON);
  const relative = (expectedMedian - comparatorMedian) / denominator;
  const adjusted = input.direction === 'LOWER_BETTER' ? -relative : relative;
  let classification: ExperimentAnalysis['classification'] = 'MIXED_EVIDENCE';
  if (adjusted > EXPERIMENT_ANALYSIS_RULES.neutralRelativeDifference) classification = 'SUPPORTS_HYPOTHESIS';
  else if (adjusted < -EXPERIMENT_ANALYSIS_RULES.neutralRelativeDifference) classification = 'CONTRADICTS_HYPOTHESIS';
  const stance = classification === 'SUPPORTS_HYPOTHESIS' ? 'SUPPORTS' : classification === 'CONTRADICTS_HYPOTHESIS' ? 'CONTRADICTS' : 'NEUTRAL';
  for (const entry of usable) evidence.push({ observationId: entry.id, stance,
    summary: `Outcome ${entry.outcomeId} contribuiu com ${input.primaryMetric} observado em janela comparavel.` });
  const averageConfidence = usable.reduce((sum, entry) => sum + Math.max(0, Math.min(1, entry.outcomeConfidence)), 0) / usable.length;
  const sampleFactor = Math.min(1, Math.min(expectedRows.length, comparatorRows.length) / EXPERIMENT_ANALYSIS_RULES.fullSamplePerVariant);
  const consistencyFactor = classification === 'MIXED_EVIDENCE' ? 0.65 : Math.min(1, Math.abs(adjusted) / 0.25);
  const confidence = round(Math.min(0.95, averageConfidence * sampleFactor * consistencyFactor));
  if (Math.min(expectedRows.length, comparatorRows.length) < EXPERIMENT_ANALYSIS_RULES.fullSamplePerVariant) limitations.push('A amostra ainda e pequena e deve ser ampliada antes de orientar estrategia.');
  const relation = classification === 'SUPPORTS_HYPOTHESIS' ? 'sao consistentes com a hipotese'
    : classification === 'CONTRADICTS_HYPOTHESIS' ? 'contradizem a hipotese observada' : 'sao mistos e nao sustentam uma direcao clara';
  const summary = `Os dados observados de ${input.primaryMetric} ${relation}: mediana ${expected.label} = ${round(expectedMedian)} e ${comparator.label} = ${round(comparatorMedian)}.`;
  const benchmark = { metric: input.primaryMetric, direction: input.direction, expectedVariant: expected.key,
    comparatorVariant: comparator.key, expectedMedian: round(expectedMedian), comparatorMedian: round(comparatorMedian),
    relativeDifference: round(relative), observationsPerVariant: Object.fromEntries([...byVariant].map(([key, rows]) => [key, rows.length])),
    comparisonContext: usable[0].comparisonContext, neutralBand: EXPERIMENT_ANALYSIS_RULES.neutralRelativeDifference };
  const status = classification === 'MIXED_EVIDENCE' ? 'INCONCLUSIVE' : 'COMPLETED';
  return { classification, status, summary, confidence, benchmark, limitations: [...new Set(limitations)],
    analysisFingerprint: hash({ experimentId: input.experimentId, classification, benchmark,
      observations: usable.map(({ id, outcomeId }) => ({ id, outcomeId })).sort((left, right) => left.id.localeCompare(right.id)) }), evidence };
};
