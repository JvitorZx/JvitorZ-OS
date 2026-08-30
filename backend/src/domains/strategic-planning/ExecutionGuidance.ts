import type { RankedPlanningCandidate } from './types';

export const PLANNING_EXECUTION_STATES = ['pending', 'in_progress', 'completed', 'skipped', 'paused'] as const;
export type PlanningExecutionState = typeof PLANNING_EXECUTION_STATES[number];

export interface ExecutionGuidance {
  state: PlanningExecutionState;
  action: string;
  confidence: number;
  context: Record<string, unknown>;
}

const clamp = (value: number): number => Math.min(1, Math.max(0, value));
const round = (value: number): number => Math.round(value * 100) / 100;

export const createExecutionGuidance = (candidate: RankedPlanningCandidate): ExecutionGuidance => {
  const stale = candidate.evidence.some(({ freshness }) => freshness === 'STALE') || candidate.freshness === 'STALE';
  const confidence = round(clamp(candidate.confidence
    - (stale ? 0.15 : 0)
    - Math.min(0.3, candidate.missingData.length * 0.05)
    - (candidate.readiness === 'NEEDS_RESEARCH' ? 0.15 : candidate.readiness === 'BLOCKED' ? 0.25 : 0)));
  const action = candidate.readiness === 'BLOCKED'
    ? `Resolver os bloqueios antes de produzir: ${candidate.title}.`
    : candidate.readiness === 'NEEDS_RESEARCH'
      ? `Investigar os dados pendentes antes de executar: ${candidate.title}.`
      : `Preparar e iniciar a producao de: ${candidate.title}.`;
  return {
    state: 'pending', action, confidence,
    context: {
      candidateKey: candidate.key,
      candidateType: candidate.candidateType,
      sourceDecisionId: candidate.sourceDecisionId ?? null,
      sourceResearchOpportunityId: candidate.sourceResearchOpportunityId ?? null,
      decisionCategory: candidate.decisionCategory ?? null,
      opportunityScore: candidate.opportunityScore,
      trend: candidate.trend ?? null,
      seriesHealth: candidate.seriesHealth ?? null,
      freshness: candidate.freshness ?? null,
      urgent: candidate.urgent,
      experimental: candidate.experimental,
      executionScore: candidate.executionScore,
      readiness: candidate.readiness,
      priority: candidate.priority,
    },
  };
};
