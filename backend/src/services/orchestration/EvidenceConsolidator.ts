import type {
  ConsolidatedConfidenceBasis,
  ConsolidatedEvidence,
  OperatorInvocation,
  OrchestrationConflict,
  OrchestrationEvidence,
  OrchestrationPlan,
  OrchestrationStepResult,
} from '../../domains/orchestration';

const unique = (items: string[]): string[] => [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, 12);

export const consolidateEvidence = (steps: OrchestrationStepResult[]): ConsolidatedEvidence => {
  const outputs = steps.flatMap(({ output }) => output ? [output] : []);
  const confidences = outputs.flatMap(({ confidence }) => (
    typeof confidence === 'number' && Number.isFinite(confidence) ? [Math.max(0, Math.min(1, confidence))] : []
  ));
  return {
    facts: unique(outputs.flatMap(({ facts = [] }) => facts)),
    inferences: unique(outputs.flatMap(({ inferences = [] }) => inferences)),
    recommendations: unique(outputs.flatMap(({ recommendations = [] }) => recommendations)),
    risks: unique(outputs.flatMap(({ risks = [] }) => risks)),
    missingData: unique(outputs.flatMap(({ missingData = [] }) => missingData)),
    confidence: confidences.length === 0
      ? 0
      : Math.round((confidences.reduce((sum, value) => sum + value, 0) / confidences.length) * 1_000) / 1_000,
  };
};

const operatorId = (capabilityId: string): string => capabilityId
  .replace(/^channel-operator\./, '')
  .replace(/\.read$|\.decide$|\.respond$/, '');

const directions = (step: OrchestrationStepResult | undefined): string[] => {
  const value = step?.output?.data?.signalDirections;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
};

export const detectOrchestrationConflicts = (steps: OrchestrationStepResult[]): OrchestrationConflict[] => {
  const byCapability = new Map(steps.map((step) => [step.capabilityId, step]));
  const conflicts: OrchestrationConflict[] = [];
  const ctr = directions(byCapability.get('channel-operator.ctr'));
  const retention = directions(byCapability.get('channel-operator.retention'));
  if (ctr.includes('positive') && retention.includes('negative')) {
    conflicts.push({
      code: 'STRONG_PACKAGING_WEAK_CONSUMPTION',
      summary: 'A embalagem esta funcionando, mas o consumo depois do clique esta fraco.',
      operatorIds: ['ctr', 'retention'],
      effect: 'reduces_confidence',
    });
  } else if (ctr.includes('negative') && retention.includes('positive')) {
    conflicts.push({
      code: 'WEAK_PACKAGING_STRONG_CONSUMPTION',
      summary: 'O consumo e saudavel entre quem clica, mas alcance e CTR limitam a entrada.',
      operatorIds: ['ctr', 'retention'],
      effect: 'reduces_confidence',
    });
  }
  const trends = directions(byCapability.get('channel-operator.trends'));
  const series = directions(byCapability.get('channel-operator.series'));
  if (trends.includes('negative') && series.includes('positive')) {
    conflicts.push({
      code: 'DECLINING_TREND_HEALTHY_SERIES',
      summary: 'A tendencia agregada caiu, enquanto a serie preserva sinais saudaveis; os recortes nao devem ser tratados como equivalentes.',
      operatorIds: ['trends', 'series'],
      effect: 'requires_more_data',
    });
  }
  return conflicts;
};

const qualityFactor = (state: unknown): number => {
  if (typeof state !== 'string') return 1;
  return ({ GOOD: 1, RECENT: 1, AVAILABLE: 1, PARTIAL: 0.75, STALE: 0.6, LIMITED: 0.6,
    MISSING: 0.25, INCONSISTENT: 0.35, ERROR: 0.25, NOT_CONFIGURED: 0.25 } as Record<string, number>)[state.toUpperCase()] ?? 0.8;
};

const average = (values: number[], fallback = 1): number => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;

export const calculateConsolidatedConfidence = (
  steps: OrchestrationStepResult[],
  evidence: ConsolidatedEvidence,
  conflicts: OrchestrationConflict[],
): { confidence: number; basis: ConsolidatedConfidenceBasis } => {
  const operatorSteps = steps.filter(({ capabilityId }) => capabilityId !== 'planner.respond');
  const completed = operatorSteps.filter(({ status }) => status === 'completed');
  const qualities: number[] = [];
  const freshness: number[] = [];
  const samples: number[] = [];
  for (const { output } of completed) {
    const quality = output?.data?.quality;
    if (quality && typeof quality === 'object' && !Array.isArray(quality)) {
      const record = quality as Record<string, unknown>;
      qualities.push(qualityFactor(record.state));
      freshness.push(qualityFactor(record.freshness));
    }
    const sample = output?.data?.sampleSize;
    if (typeof sample === 'number' && Number.isFinite(sample)) samples.push(Math.min(1, Math.max(0, sample) / 5));
  }
  const basis: ConsolidatedConfidenceBasis = {
    operatorAvailability: operatorSteps.length ? completed.length / operatorSteps.length : 0,
    dataQuality: average(qualities),
    freshness: average(freshness),
    sampleStrength: average(samples),
    conflictPenalty: Math.max(0.55, 1 - (conflicts.length * 0.15)),
    missingDataPenalty: Math.max(0.5, 1 - (evidence.missingData.length * 0.08)),
  };
  const confidence = evidence.confidence * basis.operatorAvailability * basis.dataQuality
    * basis.freshness * basis.sampleStrength * basis.conflictPenalty * basis.missingDataPenalty;
  return { confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 1_000) / 1_000, basis };
};

export const createEvidenceItems = (steps: OrchestrationStepResult[]): OrchestrationEvidence[] => {
  const items: OrchestrationEvidence[] = [];
  for (const step of steps) {
    const source = operatorId(step.capabilityId);
    for (const [classification, values] of [
      ['fact', step.output?.facts],
      ['inference', step.output?.inferences],
      ['recommendation', step.output?.recommendations],
    ] as const) {
      for (const summary of values ?? []) {
        if (!items.some((item) => item.classification === classification && item.summary === summary)) {
          items.push({ classification, summary, operatorId: source });
        }
      }
    }
  }
  return items.slice(0, 30);
};

export const createOperatorInvocations = (
  plan: OrchestrationPlan,
  steps: OrchestrationStepResult[],
): OperatorInvocation[] => steps
  .filter(({ capabilityId }) => capabilityId !== 'planner.respond')
  .map((step) => ({
    stepId: step.stepId,
    operatorId: operatorId(step.capabilityId),
    capabilityId: step.capabilityId,
    reason: plan.steps.find(({ id }) => id === step.stepId)?.objective ?? step.capabilityId,
    status: step.status,
    durationMs: step.durationMs,
    ...(step.errorType ? { errorType: step.errorType } : {}),
  }));

export const composeOrchestrationResponse = (evidence: ConsolidatedEvidence): string => {
  const recommendation = evidence.recommendations[0]
    ?? 'Ainda não existe evidência suficiente para uma recomendação específica.';
  return [
    recommendation,
    evidence.facts[0] ? `Fato principal: ${evidence.facts[0]}` : null,
    evidence.inferences[0] ? `Inferência: ${evidence.inferences[0]}` : null,
    evidence.risks[0] ? `Risco: ${evidence.risks[0]}` : null,
    evidence.missingData[0] ? `Dado ausente: ${evidence.missingData[0]}` : null,
    `Confiança consolidada: ${Math.round(evidence.confidence * 100)}%.`,
  ].filter((line): line is string => Boolean(line)).join('\n');
};
