import { createHash } from 'node:crypto';
import type {
  MonitoringFact,
  MonitoringRuleDefinition,
  StrategicSignalCandidate,
  StrategicSignalType,
} from './types';

// These are public product rules. Upstream domains decide whether a change is meaningful;
// monitoring only turns those already-classified states into deduplicated signals.
export const STRATEGIC_MONITORING_POLICY = Object.freeze({
  opportunityExpiringHours: 24,
  defaultCooldownHours: 24,
  urgentCooldownHours: 6,
});

const definitions: Record<StrategicSignalType, Omit<MonitoringRuleDefinition, 'code' | 'signalType'>> = {
  TREND_DECLINING: { defaultSeverity: 'MEDIUM', cooldownHours: 24, description: 'Uma tendencia significativa foi classificada como declining pelo dominio temporal.' },
  TREND_RISING: { defaultSeverity: 'LOW', cooldownHours: 24, description: 'Uma tendencia significativa foi classificada como rising pelo dominio temporal.' },
  DATA_STALE: { defaultSeverity: 'MEDIUM', cooldownHours: 24, description: 'Dados persistidos deixaram a janela de freshness do dominio de origem.' },
  DATA_MISSING: { defaultSeverity: 'HIGH', cooldownHours: 24, description: 'Uma fonte necessaria nao possui dados observaveis.' },
  DATA_QUALITY_DEGRADED: { defaultSeverity: 'HIGH', cooldownHours: 6, description: 'A qualidade declarada por uma fonte ficou degradada.' },
  SERIES_DECLINING: { defaultSeverity: 'MEDIUM', cooldownHours: 24, description: 'A saude de uma serie foi classificada como declining.' },
  SERIES_DORMANT: { defaultSeverity: 'LOW', cooldownHours: 72, description: 'Uma serie deixou a janela de publicacao recente definida pelo dominio temporal.' },
  OPPORTUNITY_EXPIRING: { defaultSeverity: 'MEDIUM', cooldownHours: 12, description: 'Uma oportunidade esta proxima do validUntil persistido.' },
  OPPORTUNITY_STALE: { defaultSeverity: 'MEDIUM', cooldownHours: 24, description: 'Uma oportunidade foi classificada como stale pela pesquisa.' },
  PLANNING_BLOCKED: { defaultSeverity: 'HIGH', cooldownHours: 12, description: 'Um item do plano atual esta bloqueado.' },
  EXPERIMENT_INCONCLUSIVE: { defaultSeverity: 'MEDIUM', cooldownHours: 24, description: 'Um experimento terminou sem evidencia comparavel suficiente.' },
  LEARNING_CONTRADICTED: { defaultSeverity: 'HIGH', cooldownHours: 12, description: 'Evidencias novas contradizem um aprendizado estrategico anterior.' },
  LEARNING_STALE: { defaultSeverity: 'LOW', cooldownHours: 72, description: 'As evidencias de um aprendizado estrategico ficaram stale.' },
};

export const STRATEGIC_MONITORING_RULES: readonly MonitoringRuleDefinition[] = Object.entries(definitions)
  .map(([signalType, definition]) => ({ code: `MONITOR_${signalType}`, signalType: signalType as StrategicSignalType, ...definition }));

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`;
  return JSON.stringify(value);
};

const hash = (value: unknown): string => createHash('sha256').update(stable(value)).digest('hex');
const boundedConfidence = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 10_000) / 10_000;

export const buildStrategicSignalCandidates = (facts: readonly MonitoringFact[]): StrategicSignalCandidate[] => facts
  .map((fact) => {
    const rule = STRATEGIC_MONITORING_RULES.find(({ signalType }) => signalType === fact.type)!;
    const logicalKey = hash({ type: fact.type, source: fact.source, sourceId: fact.sourceId });
    const normalized = {
      ...fact,
      confidence: boundedConfidence(fact.confidence),
      limitations: [...new Set(fact.limitations)].sort(),
      evidence: [...new Set(fact.evidence)].sort(),
    };
    return {
      ...normalized,
      logicalKey,
      severity: rule.defaultSeverity,
      ruleCode: rule.code,
      fingerprint: hash({
        logicalKey,
        stateValue: fact.stateValue,
        summary: fact.summary,
        impact: fact.impact,
        confidence: normalized.confidence,
        limitations: normalized.limitations,
        evidence: normalized.evidence,
        metadata: fact.metadata ?? {},
      }),
    };
  })
  .sort((left, right) => left.logicalKey.localeCompare(right.logicalKey));

export const monitoringEvaluationFingerprint = (
  projectId: string | null,
  candidates: readonly StrategicSignalCandidate[],
  evaluatedSources: readonly string[],
  sourceState: Record<string, string>,
  projectedSignals: readonly { logicalKey: string; fingerprint: string; state: string; lifecycleMarker?: string | null }[] = [],
): string => hash({
  projectId,
  candidates: candidates.map(({ logicalKey, fingerprint }) => ({ logicalKey, fingerprint })),
  evaluatedSources: [...evaluatedSources].sort(),
  sourceState,
  projectedSignals: [...projectedSignals].sort((left, right) => left.logicalKey.localeCompare(right.logicalKey)),
});
