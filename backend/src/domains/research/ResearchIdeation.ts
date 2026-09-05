import { createHash } from 'crypto';
import type { ResearchEvidence, ResearchFreshness, ResearchOpportunity, ResearchSubjectType } from './types';

export const RESEARCH_SESSION_STATUSES = ['DRAFT', 'RUNNING', 'COMPLETED', 'FAILED', 'ARCHIVED'] as const;
export const VIDEO_IDEA_STATUSES = ['DRAFT', 'CANDIDATE', 'SHORTLISTED', 'SELECTED', 'REJECTED', 'PLANNED', 'PRODUCED', 'ARCHIVED'] as const;
export const PRODUCTION_EFFORTS = ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'] as const;
export const RESEARCH_QUALITY_GATES = ['READY', 'READY_WITH_WARNINGS', 'INSUFFICIENT_EVIDENCE', 'STALE', 'NEEDS_REVIEW'] as const;
export type ResearchSessionStatus = typeof RESEARCH_SESSION_STATUSES[number];
export type VideoIdeaStatus = typeof VIDEO_IDEA_STATUSES[number];
export type ProductionEffort = typeof PRODUCTION_EFFORTS[number];
export type ResearchQualityGate = typeof RESEARCH_QUALITY_GATES[number];

export interface OpportunityScoreDimension {
  key: 'CHANNEL_FIT' | 'STRATEGIC_FIT' | 'HISTORICAL_SUPPORT' | 'RECENCY' | 'NOVELTY' | 'CONTINUITY' | 'PRODUCTION_EFFORT' | 'SATURATION_RISK' | 'EVIDENCE_QUALITY' | 'EXPERIMENT_VALUE';
  value: number | null;
  rationale: string;
}

export interface ExplainableOpportunityScore {
  relativeScore: number;
  dimensions: OpportunityScoreDimension[];
  reasons: string[];
  risks: string[];
  missingData: string[];
  qualityGate: ResearchQualityGate;
  disclaimer: string;
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const rounded = (value: number): number => Math.round(value * 1_000) / 1_000;
const freshnessValue: Record<ResearchFreshness, number | null> = { RECENT: 1, AGING: 0.65, STALE: 0.3, MISSING: null };
const effortValue: Record<ProductionEffort, number | null> = { LOW: 1, MEDIUM: 0.65, HIGH: 0.3, UNKNOWN: null };
const normalize = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (value: string): Set<string> => new Set(normalize(value).split(' ').filter((item) => item.length > 2));

export const ideaIdentityKey = (input: { game?: string | null; series?: string | null; format: string; premise: string; coreEvent?: string | null }): string =>
  createHash('sha256').update(JSON.stringify({
    game: normalize(input.game ?? ''), series: normalize(input.series ?? ''), format: normalize(input.format),
    premise: normalize(input.premise), coreEvent: normalize(input.coreEvent ?? ''),
  })).digest('hex');

export const ideaSimilarity = (left: { game?: string | null; series?: string | null; format: string; premise: string; coreEvent?: string | null }, right: typeof left): number => {
  if (normalize(left.format) !== normalize(right.format)) return 0;
  if (left.game && right.game && normalize(left.game) !== normalize(right.game)) return 0;
  const a = tokens(`${left.premise} ${left.coreEvent ?? ''} ${left.series ?? ''}`);
  const b = tokens(`${right.premise} ${right.coreEvent ?? ''} ${right.series ?? ''}`);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((item) => b.has(item)).length;
  return rounded(intersection / new Set([...a, ...b]).size);
};
const gateFor = (opportunity: ResearchOpportunity, evidence: readonly ResearchEvidence[], duplicate: boolean): ResearchQualityGate => {
  if (!evidence.length || opportunity.state === 'INSUFFICIENT_DATA') return 'INSUFFICIENT_EVIDENCE';
  if (opportunity.freshness === 'STALE' || opportunity.freshness === 'MISSING') return 'STALE';
  if (duplicate || opportunity.risks.some((risk) => /conflit/i.test(risk))) return 'NEEDS_REVIEW';
  if (opportunity.gaps.length || opportunity.risks.length > 1) return 'READY_WITH_WARNINGS';
  return 'READY';
};

export const scoreOpportunity = (opportunity: ResearchOpportunity, input: {
  effort?: ProductionEffort;
  objective?: string | null;
  duplicate?: boolean;
} = {}): ExplainableOpportunityScore => {
  const effort = input.effort ?? 'UNKNOWN';
  const evidence = opportunity.evidence ?? [];
  const facts = evidence.filter(({ classification }) => classification === 'fact');
  const inferred = evidence.filter(({ classification }) => classification !== 'fact');
  const explored = evidence.some(({ context }) => context.explored === true);
  const sampleSizes = evidence.flatMap(({ context }) => typeof context.sampleSize === 'number' ? [context.sampleSize] : []);
  const dimensions: OpportunityScoreDimension[] = [
    { key: 'CHANNEL_FIT', value: rounded(clamp(opportunity.compatibility)), rationale: 'Compatibilidade relativa calculada a partir do contexto interno disponível.' },
    { key: 'STRATEGIC_FIT', value: input.objective ? rounded(clamp(opportunity.compatibility)) : null, rationale: input.objective ? `Aderência ao objetivo informado: ${input.objective}.` : 'Objetivo estratégico não informado.' },
    { key: 'HISTORICAL_SUPPORT', value: facts.length ? rounded(clamp(opportunity.confidence)) : null, rationale: facts.length ? `${facts.length} fato(s) interno(s) sustentam a avaliação.` : 'Não há fato histórico suficiente.' },
    { key: 'RECENCY', value: freshnessValue[opportunity.freshness], rationale: `Freshness observada: ${opportunity.freshness}.` },
    { key: 'NOVELTY', value: explored ? 0.35 : 0.8, rationale: explored ? 'O assunto já aparece no histórico interno.' : 'O assunto acrescenta exploração ao histórico disponível.' },
    { key: 'CONTINUITY', value: opportunity.subjectType === 'SERIES' ? 0.8 : null, rationale: opportunity.subjectType === 'SERIES' ? 'O candidato possui continuidade de série explícita.' : 'Continuidade de série não identificada.' },
    { key: 'PRODUCTION_EFFORT', value: effortValue[effort], rationale: effort === 'UNKNOWN' ? 'Esforço de produção não informado.' : `Esforço de produção informado: ${effort}.` },
    { key: 'SATURATION_RISK', value: explored && sampleSizes.some((size) => size >= 3) ? 0.4 : null, rationale: explored && sampleSizes.some((size) => size >= 3) ? 'Há recorrência interna suficiente para revisar saturação.' : 'Saturação não pôde ser determinada.' },
    { key: 'EVIDENCE_QUALITY', value: evidence.length ? rounded(clamp(opportunity.confidence)) : null, rationale: `${evidence.length} evidência(s), ${inferred.length} inferência(s).` },
    { key: 'EXPERIMENT_VALUE', value: explored ? 0.35 : 0.75, rationale: explored ? 'Candidato de exploração limitada.' : 'Pode produzir uma nova observação, sem garantia de performance.' },
  ];
  const known = dimensions.flatMap(({ value }) => value === null ? [] : [value]);
  const relativeScore = known.length ? Math.round((known.reduce((sum, value) => sum + value, 0) / known.length) * 100) : 0;
  const missingData = [...new Set([
    ...opportunity.gaps,
    ...dimensions.filter(({ value }) => value === null).map(({ key }) => key.toLowerCase().replace(/_/g, ' ')),
  ])];
  const risks = [...new Set([
    ...opportunity.risks,
    ...(input.duplicate ? ['Possível repetição de uma ideia recente; revisão humana necessária.'] : []),
  ])];
  return {
    relativeScore, dimensions,
    reasons: dimensions.filter(({ value }) => value !== null && value >= 0.65).map(({ rationale }) => rationale).slice(0, 5),
    risks, missingData, qualityGate: gateFor(opportunity, evidence, input.duplicate === true),
    disclaimer: 'Score interno relativo para priorização; não é probabilidade, previsão de views, CTR previsto ou garantia de performance.',
  };
};

export const buildIdeaFromOpportunity = (opportunity: ResearchOpportunity, input: {
  objective: string;
  format: string;
  effort?: ProductionEffort;
  game?: string | null;
  series?: string | null;
}) => {
  const subject = opportunity.subject.trim();
  const objective = input.objective.trim();
  const coreEvent = objective;
  const premise = `${subject}: ${objective}`;
  const score = scoreOpportunity(opportunity, { effort: input.effort, objective });
  return {
    theme: subject, workingTitle: premise, game: input.game ?? (opportunity.subjectType === 'GAME' ? subject : null),
    series: input.series ?? (opportunity.subjectType === 'SERIES' ? subject : null), format: input.format,
    premise, coreEvent, viewerPromise: `Acompanhar ${objective.toLowerCase()} com um acontecimento verificável em ${subject}.`,
    whyNow: opportunity.summary, effortLevel: input.effort ?? 'UNKNOWN', estimatedEffort: input.effort === 'LOW' ? 25 : input.effort === 'MEDIUM' ? 50 : input.effort === 'HIGH' ? 80 : null,
    novelty: score.dimensions.find(({ key }) => key === 'NOVELTY')?.value == null ? null : score.dimensions.find(({ key }) => key === 'NOVELTY')!.value! * 100,
    identityFit: opportunity.compatibility * 100, strategicFit: opportunity.compatibility * 100,
    opportunityScore: score.relativeScore, scoreDetails: score, risks: score.risks,
    assumptions: ['A ideia permanece uma hipótese editorial até produzir evidência observável.'],
    hypothesis: `Os dados observados são compatíveis com testar ${objective.toLowerCase()} em ${subject}; isso não estabelece causalidade.`,
  };
};
