import type {
  ExecutionReadiness,
  PlanningCandidate,
  PlanningGenerationResult,
  PlanningHorizon,
  PlanningPriority,
  PlanningRisk,
  RankedPlanningCandidate,
} from './types';

const HORIZON_LIMITS: Record<PlanningHorizon, number> = {
  TODAY: 3,
  NEXT_3_DAYS: 5,
  NEXT_7_DAYS: 8,
  NEXT_14_DAYS: 12,
};
const clamp = (value: number, min = 0, max = 100): number => Math.min(max, Math.max(min, value));
const round = (value: number): number => Math.round(value * 100) / 100;
const normalized = (value?: string): string => value?.trim().toUpperCase() ?? '';

const readinessFor = (candidate: PlanningCandidate): ExecutionReadiness => {
  if (candidate.constraints.some(({ blocking }) => blocking)
    || candidate.dependencies.some(({ status }) => status === 'BLOCKED')
    || ['PAUSE'].includes(normalized(candidate.decisionCategory))) return 'BLOCKED';
  if (candidate.dependencies.some(({ status }) => status === 'PENDING')
    || candidate.missingData.length > 0
    || ['INSUFFICIENT_DATA'].includes(normalized(candidate.decisionCategory))
    || ['INSUFFICIENT_DATA', 'WEAK_SIGNAL'].includes(normalized(candidate.researchState))) return 'NEEDS_RESEARCH';
  return 'READY';
};

const urgentFor = (candidate: PlanningCandidate): boolean => (
  normalized(candidate.trend) === 'RISING' && normalized(candidate.freshness) === 'RECENT'
) || (
  normalized(candidate.seriesHealth) === 'STRONG'
  && typeof candidate.daysSinceLastEpisode === 'number'
  && candidate.daysSinceLastEpisode >= 14
) || normalized(candidate.freshness) === 'AGING';

const experimentalFor = (candidate: PlanningCandidate): boolean => (
  normalized(candidate.decisionCategory) === 'TEST'
  || !candidate.sourceDecisionId
  || ['PROMISING', 'WATCH', 'WEAK_SIGNAL'].includes(normalized(candidate.researchState))
);

const scoreFor = (candidate: PlanningCandidate, readiness: ExecutionReadiness, urgent: boolean): number => {
  const editorial = candidate.opportunityScore === null ? candidate.confidence * 60 : candidate.opportunityScore;
  const freshness = ({ RECENT: 7, AGING: 3, STALE: -10, MISSING: -8 } as Record<string, number>)[normalized(candidate.freshness)] ?? 0;
  const trend = ({ RISING: 8, STABLE: 1, VOLATILE: -3, DECLINING: -8, INSUFFICIENT_DATA: -5 } as Record<string, number>)[normalized(candidate.trend)] ?? 0;
  const series = ({ STRONG: 7, HEALTHY: 3, DORMANT: 2, VOLATILE: -3, DECLINING: -9, INSUFFICIENT_DATA: -5 } as Record<string, number>)[normalized(candidate.seriesHealth)] ?? 0;
  const effort = ({ LOW: 8, MEDIUM: 3, HIGH: -9, UNKNOWN: -3 } as Record<string, number>)[candidate.effort];
  const research = ({ HIGH_INTEREST: 7, PROMISING: 4, WATCH: 0, WEAK_SIGNAL: -5, INSUFFICIENT_DATA: -9 } as Record<string, number>)[normalized(candidate.researchState)] ?? 0;
  const penalties = candidate.missingData.length * 2 + candidate.constraints.filter(({ blocking }) => !blocking).length;
  const readinessAdjustment = readiness === 'BLOCKED' ? -35 : readiness === 'NEEDS_RESEARCH' ? -12 : 0;
  return round(clamp(editorial * 0.62 + candidate.confidence * 18 + freshness + trend + series + effort + research
    + (urgent ? 6 : 0) - penalties + readinessAdjustment));
};

const priorityFor = (score: number, urgent: boolean, experimental: boolean): PlanningPriority => {
  if (urgent && score >= 68) return 'CRITICAL';
  if (experimental) return 'EXPERIMENTAL';
  if (score >= 68) return 'HIGH';
  if (score >= 48) return 'MEDIUM';
  return 'LOW';
};

const balance = (items: RankedPlanningCandidate[]): RankedPlanningCandidate[] => {
  const urgent = items.filter(({ urgent: value }) => value);
  const remaining = items.filter(({ urgent: value }) => !value);
  const proven = remaining.filter(({ experimental }) => !experimental);
  const experiments = remaining.filter(({ experimental }) => experimental);
  const ordered = [...urgent];
  while (proven.length || experiments.length) {
    ordered.push(...proven.splice(0, 2));
    ordered.push(...experiments.splice(0, 1));
  }
  return [...new Map(ordered.map((item) => [item.key, item])).values()];
};

export class StrategicPlanningRanker {
  rank(input: readonly PlanningCandidate[], horizon: PlanningHorizon): PlanningGenerationResult {
    const repetition = new Map<string, number>();
    for (const candidate of input) {
      if (candidate.repetitionKey) repetition.set(candidate.repetitionKey, (repetition.get(candidate.repetitionKey) ?? 0) + 1);
    }
    const ranked = input.map((source): RankedPlanningCandidate => {
      const candidate = structuredClone(source);
      const repeated = candidate.repetitionKey && (repetition.get(candidate.repetitionKey) ?? 0) >= 3;
      if (repeated) candidate.risks.push({
        code: 'REPETITION_RISK', severity: 'MEDIUM',
        summary: `Repeticao elevada de ${candidate.repetitionKey}; diversifique sem bloquear automaticamente.`,
      });
      const readiness = readinessFor(candidate);
      const urgent = urgentFor(candidate);
      const experimental = experimentalFor(candidate);
      const executionScore = scoreFor(candidate, readiness, urgent);
      const priority = priorityFor(executionScore, urgent, experimental);
      const blockers = candidate.constraints.filter(({ blocking }) => blocking).map(({ summary }) => summary);
      const rationale = readiness === 'BLOCKED'
        ? `Bloqueado por: ${blockers.join('; ') || 'dependencia operacional pendente'}.`
        : readiness === 'NEEDS_RESEARCH'
          ? `Aguarda pesquisa ou dados: ${candidate.missingData.join(', ') || 'dependencia editorial pendente'}.`
          : `${candidate.title} vem nesta posicao pelo score editorial existente, confianca, freshness, esforco e urgencia operacional.`;
      return { ...candidate, executionScore, priority, readiness, queue: 'LATER', rank: 0, experimental, urgent, rationale };
    }).sort((left, right) => right.executionScore - left.executionScore
      || right.confidence - left.confidence || left.key.localeCompare(right.key));

    const selected = balance(ranked).slice(0, HORIZON_LIMITS[horizon]);
    let nextAssigned = false;
    const candidates = selected.map((candidate, index): RankedPlanningCandidate => {
      let queue: RankedPlanningCandidate['queue'];
      if (candidate.readiness === 'BLOCKED') queue = 'BLOCKED';
      else if (candidate.readiness === 'NEEDS_RESEARCH') queue = 'WAITING';
      else if (!nextAssigned) { queue = 'NEXT'; nextAssigned = true; }
      else queue = 'LATER';
      return { ...candidate, queue, rank: index + 1 };
    });
    const risks: PlanningRisk[] = [...new Map(candidates.flatMap(({ risks }) => risks).map((risk) => [risk.code + risk.summary, risk])).values()];
    const ready = candidates.filter(({ readiness }) => readiness === 'READY').length;
    const needsResearch = candidates.filter(({ readiness }) => readiness === 'NEEDS_RESEARCH').length;
    return {
      horizon,
      status: ready > 0 ? 'READY' : needsResearch > 0 ? 'NEEDS_RESEARCH' : candidates.length ? 'BLOCKED' : 'DRAFT',
      candidates,
      balance: {
        proven: candidates.filter(({ experimental }) => !experimental).length,
        experimental: candidates.filter(({ experimental }) => experimental).length,
        policy: 'Ate um item experimental depois de dois comprovados, salvo urgencias baseadas em evidencia fresca.',
      },
      risks,
    };
  }
}
