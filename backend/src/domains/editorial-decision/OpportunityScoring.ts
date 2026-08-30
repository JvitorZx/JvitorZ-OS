import {
  OPPORTUNITY_FACTOR_IDS,
  type DecisionConstraint,
  type DecisionEvidence,
  type DecisionRisk,
  type EditorialCandidate,
  type EditorialDecisionCategory,
  type OpportunityFactor,
  type OpportunityFactorId,
  type OpportunityScore,
  type RankedEditorialCandidate,
} from './types';

export const OPPORTUNITY_FACTOR_WEIGHTS: Readonly<Record<OpportunityFactorId, number>> = Object.freeze({
  HISTORICAL_PERFORMANCE: 0.15,
  TREND: 0.13,
  SERIES_HEALTH: 0.13,
  FORMAT_FIT: 0.11,
  RETENTION: 0.11,
  CTR: 0.11,
  WATCH_TIME: 0.07,
  SUBSCRIBER_GAIN: 0.05,
  AUDIENCE_RESPONSE: 0.07,
  EDITORIAL_FIT: 0.07,
});

const QUALITY_MULTIPLIERS: Readonly<Record<string, number>> = Object.freeze({
  GOOD: 1,
  RECENT: 1,
  AVAILABLE: 0.9,
  PARTIAL: 0.7,
  LIMITED: 0.65,
  STALE: 0.5,
  INCONSISTENT: 0.3,
  MISSING: 0,
  ERROR: 0,
  NOT_CONFIGURED: 0,
});

const clamp = (value: number, minimum = 0, maximum = 100): number =>
  Math.min(maximum, Math.max(minimum, value));

const rounded = (value: number, digits = 2): number => {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
};

const qualityMultiplier = (quality: string): number =>
  QUALITY_MULTIPLIERS[quality.trim().toUpperCase()] ?? 0.5;

const categoryFor = (
  candidate: EditorialCandidate,
  score: number,
  confidence: number,
  coverage: number,
  hasConflict: boolean,
): EditorialDecisionCategory => {
  if (coverage < 0.2 || confidence < 0.2) return 'INSUFFICIENT_DATA';
  if (hasConflict) return 'REEVALUATE';
  if (score >= 75) return 'PRIORITIZE';
  if (candidate.type === 'SERIES' && score >= 58) return 'CONTINUE';
  if (score >= 52) return 'TEST';
  if (score >= 38) return 'HOLD';
  if (score < 28 && confidence >= 0.5) return 'PAUSE';
  return 'REEVALUATE';
};

const evidenceFrom = (factor: OpportunityFactor, direction: DecisionEvidence['direction']): DecisionEvidence => ({
  direction,
  classification: factor.classification,
  source: factor.source,
  summary: factor.summary,
  confidence: rounded(clamp(factor.confidence, 0, 1), 3),
});

export class OpportunityScoringService {
  score(
    candidate: EditorialCandidate,
    factors: readonly OpportunityFactor[],
    constraints: readonly DecisionConstraint[] = [],
    suppliedRisks: readonly DecisionRisk[] = [],
  ): OpportunityScore {
    const byId = new Map<OpportunityFactorId, OpportunityFactor>();
    for (const factor of factors) {
      if (!OPPORTUNITY_FACTOR_IDS.includes(factor.id)) continue;
      if (!byId.has(factor.id)) byId.set(factor.id, { ...factor });
    }

    const components = OPPORTUNITY_FACTOR_IDS.map((id) => {
      const factor = byId.get(id) ?? {
        id,
        value: null,
        confidence: 0,
        quality: 'MISSING',
        source: 'unavailable',
        summary: `${id} indisponível para este candidato.`,
        classification: 'fact' as const,
      };
      const weight = OPPORTUNITY_FACTOR_WEIGHTS[id];
      const multiplier = qualityMultiplier(factor.quality);
      return {
        ...factor,
        value: factor.value === null ? null : rounded(clamp(factor.value)),
        confidence: rounded(clamp(factor.confidence, 0, 1), 3),
        weight,
        effectiveWeight: factor.value === null ? 0 : rounded(weight * multiplier, 4),
        qualityMultiplier: multiplier,
      };
    });
    const available = components.filter((component) => component.value !== null && component.effectiveWeight > 0);
    const knownWeight = available.reduce((sum, component) => sum + component.weight, 0);
    const effectiveWeight = available.reduce((sum, component) => sum + component.effectiveWeight, 0);
    const value = effectiveWeight === 0 ? 0 : available.reduce(
      (sum, component) => sum + component.value! * component.effectiveWeight,
      0,
    ) / effectiveWeight;
    const coverage = rounded(knownWeight, 3);
    const confidenceBase = knownWeight === 0 ? 0 : available.reduce(
      (sum, component) => sum + component.confidence * component.effectiveWeight,
      0,
    ) / knownWeight;
    const confidence = rounded(confidenceBase * (0.5 + coverage * 0.5), 3);
    const favorableFactors = available.filter((component) => component.value! >= 60);
    const contraryFactors = available.filter((component) => component.value! <= 40);
    const hasConflict = favorableFactors.some(({ confidence: factorConfidence }) => factorConfidence >= 0.55)
      && contraryFactors.some(({ confidence: factorConfidence }) => factorConfidence >= 0.55);
    const risks: DecisionRisk[] = [
      ...suppliedRisks.map((risk) => ({ ...risk })),
      ...(coverage < 0.5 ? [{ code: 'LIMITED_COVERAGE', severity: 'MEDIUM' as const, summary: 'Menos da metade dos fatores possui evidência utilizável.' }] : []),
      ...(hasConflict ? [{ code: 'CONFLICTING_SIGNALS', severity: 'MEDIUM' as const, summary: 'Existem sinais favoráveis e contrários com confiança relevante.' }] : []),
      ...components.filter(({ value: factorValue, quality }) => factorValue !== null && ['STALE', 'INCONSISTENT', 'ERROR'].includes(quality.toUpperCase()))
        .map(({ id, quality, source }) => ({ code: `QUALITY_${id}`, severity: quality.toUpperCase() === 'ERROR' ? 'HIGH' as const : 'MEDIUM' as const, summary: `${id} usa dados ${quality.toUpperCase()}.`, source })),
    ];
    const score = rounded(value);
    const category = categoryFor(candidate, score, confidence, coverage, hasConflict);
    const missingData = components.filter(({ value: factorValue }) => factorValue === null).map(({ id }) => id);
    const strongest = [...available].sort((left, right) => right.value! - left.value! || left.id.localeCompare(right.id))[0];
    const weakest = [...available].sort((left, right) => left.value! - right.value! || left.id.localeCompare(right.id))[0];
    const rationale = category === 'INSUFFICIENT_DATA'
      ? `${candidate.label} ainda não possui cobertura e confiança suficientes para uma decisão editorial forte.`
      : `${candidate.label} recebeu score relativo ${score}/100. ${strongest ? `Maior apoio: ${strongest.summary}` : ''}${weakest && weakest.id !== strongest?.id ? ` Principal ressalva: ${weakest.summary}` : ''}`.trim();

    return {
      value: score,
      confidence,
      coverage,
      category,
      components,
      favorableEvidence: favorableFactors.map((factor) => evidenceFrom(factor, 'favorable')),
      contraryEvidence: contraryFactors.map((factor) => evidenceFrom(factor, 'contrary')),
      risks,
      constraints: constraints.map((constraint) => ({ ...constraint })),
      missingData,
      rationale,
      disclaimer: 'Score relativo de oportunidade; não prevê views. Confiança mede qualidade e cobertura da evidência, não probabilidade de sucesso.',
    };
  }

  rank(
    candidates: ReadonlyArray<{
      candidate: EditorialCandidate;
      factors: readonly OpportunityFactor[];
      constraints?: readonly DecisionConstraint[];
      risks?: readonly DecisionRisk[];
    }>,
  ): RankedEditorialCandidate[] {
    return candidates
      .map((input) => ({ candidate: { ...input.candidate }, opportunity: this.score(input.candidate, input.factors, input.constraints, input.risks) }))
      .sort((left, right) => right.opportunity.value - left.opportunity.value
        || right.opportunity.confidence - left.opportunity.confidence
        || left.candidate.key.localeCompare(right.candidate.key))
      .map((result, index) => ({ rank: index + 1, ...result }));
  }
}
