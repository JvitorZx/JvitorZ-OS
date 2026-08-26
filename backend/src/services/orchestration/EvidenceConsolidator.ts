import type { ConsolidatedEvidence, OrchestrationStepResult } from '../../domains/orchestration';

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
