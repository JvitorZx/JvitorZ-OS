import type { VideoIdea } from '@prisma/client';
import {
  IDEA_SCORE_FACTORS,
  clampScore,
  type ContentDecisionCategory,
  type IdeaEvaluation,
  type IdeaScoreComponent,
  type IdeaScoreFactor,
  type RankedIdeaEvaluation,
  type ResearchEvidence,
} from '../../domains/creator-intelligence/types';

const FACTOR_WEIGHTS: Readonly<Record<IdeaScoreFactor, number>> = Object.freeze({
  gamePerformance: 0.18,
  formatPerformance: 0.15,
  similarContentPerformance: 0.15,
  premiseClarity: 0.17,
  novelty: 0.12,
  productionEffort: 0.1,
  channelIdentityFit: 0.13,
});

const FACTOR_LABELS: Readonly<Record<IdeaScoreFactor, string>> = Object.freeze({
  gamePerformance: 'desempenho histórico do jogo',
  formatPerformance: 'desempenho histórico do formato',
  similarContentPerformance: 'conteúdos semelhantes',
  premiseClarity: 'clareza da premissa',
  novelty: 'novidade',
  productionEffort: 'esforço de produção',
  channelIdentityFit: 'compatibilidade com o canal',
});

const averageEvidence = (items: readonly ResearchEvidence[]): number | null => {
  if (items.length === 0) return null;

  const totalWeight = items.reduce(
    (total, item) => total + Math.max(1, item.sampleSize ?? 1) * (item.confidence ?? 1),
    0,
  );
  if (totalWeight === 0) return null;
  const weightedTotal = items.reduce(
    (total, item) => total
      + clampScore(item.value) * Math.max(1, item.sampleSize ?? 1) * (item.confidence ?? 1),
    0,
  );
  return clampScore(weightedTotal / totalWeight);
};

const scorePremiseClarity = (idea: VideoIdea): number => {
  const words = idea.premise.trim().split(/\s+/).filter(Boolean);
  const premiseLength = Array.from(idea.premise.trim()).length;
  const hasSpecificSubject = Boolean(idea.game?.trim() || idea.theme.trim());
  const hasUsefulLength = premiseLength >= 30 && premiseLength <= 280;
  return clampScore(
    20
      + Math.min(words.length, 12) * 4
      + (hasSpecificSubject ? 16 : 0)
      + (hasUsefulLength ? 16 : 0),
  );
};

const scoreProductionEffort = (estimatedEffort: number | null): number | null => {
  if (estimatedEffort === null) return null;
  return clampScore(100 - ((estimatedEffort - 1) / 4) * 100);
};

const toCategory = (score: number): ContentDecisionCategory => {
  if (score >= 75) return 'GRAVAR';
  if (score >= 55) return 'TESTAR';
  if (score >= 35) return 'GUARDAR';
  return 'DESCARTAR';
};

const buildComponent = (
  factor: IdeaScoreFactor,
  value: number | null,
  evidence: readonly ResearchEvidence[],
  inferredRationale?: string,
): IdeaScoreComponent => ({
  factor,
  value,
  weight: FACTOR_WEIGHTS[factor],
  classification: value === null
    ? 'unknown'
    : evidence.length > 0
      ? evidence.some(({ classification }) => classification === 'real') ? 'real' : 'inference'
      : 'inference',
  rationale: value === null
    ? `Ainda não há informação suficiente sobre ${FACTOR_LABELS[factor]}.`
    : evidence.length > 0
      ? evidence.map(({ summary }) => summary).join(' ')
      : inferredRationale ?? `${FACTOR_LABELS[factor]} estimado em ${value.toFixed(1)}/100.`,
  sources: [...new Set(evidence.map(({ source }) => source))],
});

export class IdeaEvaluationService {
  evaluate(idea: VideoIdea, research: readonly ResearchEvidence[] = []): IdeaEvaluation {
    const evidenceByFactor = new Map<IdeaScoreFactor, ResearchEvidence[]>();
    for (const factor of IDEA_SCORE_FACTORS) evidenceByFactor.set(factor, []);
    for (const item of research) evidenceByFactor.get(item.factor)?.push(item);

    const components: IdeaScoreComponent[] = [
      buildComponent(
        'gamePerformance',
        averageEvidence(evidenceByFactor.get('gamePerformance') ?? []),
        evidenceByFactor.get('gamePerformance') ?? [],
      ),
      buildComponent(
        'formatPerformance',
        averageEvidence(evidenceByFactor.get('formatPerformance') ?? []),
        evidenceByFactor.get('formatPerformance') ?? [],
      ),
      buildComponent(
        'similarContentPerformance',
        averageEvidence(evidenceByFactor.get('similarContentPerformance') ?? []),
        evidenceByFactor.get('similarContentPerformance') ?? [],
      ),
      buildComponent(
        'premiseClarity',
        scorePremiseClarity(idea),
        [],
        'A clareza foi inferida apenas pela especificidade e pelo tamanho da premissa.',
      ),
      buildComponent(
        'novelty',
        idea.novelty === null ? null : clampScore(idea.novelty),
        [],
        'A novidade é uma estimativa informada no cadastro da ideia.',
      ),
      buildComponent(
        'productionEffort',
        scoreProductionEffort(idea.estimatedEffort),
        [],
        'Menor esforço estimado recebe pontuação operacional maior.',
      ),
      buildComponent(
        'channelIdentityFit',
        idea.identityFit === null ? null : clampScore(idea.identityFit),
        [],
        'A compatibilidade é uma estimativa informada no cadastro da ideia.',
      ),
    ];

    const known = components.filter(
      (component): component is IdeaScoreComponent & { value: number } => component.value !== null,
    );
    const knownWeight = known.reduce((total, component) => total + component.weight, 0);
    const score = knownWeight === 0
      ? 0
      : clampScore(
        known.reduce((total, component) => total + component.value * component.weight, 0)
          / knownWeight,
      );
    const category = toCategory(score);
    const strongest = [...known].sort((left, right) => right.value - left.value)[0];
    const unknownFactors = components
      .filter(({ value }) => value === null)
      .map(({ factor }) => factor);
    const rationale = [
      `Recomendação ${category} com score relativo ${score.toFixed(1)}/100.`,
      strongest
        ? `O sinal mais favorável é ${FACTOR_LABELS[strongest.factor]}.`
        : 'Não há evidência suficiente para destacar um fator favorável.',
      unknownFactors.length > 0
        ? `${unknownFactors.length} fator(es) ainda são desconhecidos.`
        : 'Todos os fatores básicos possuem alguma evidência.',
      'Este score compara ideias; não prevê visualizações.',
    ].join(' ');
    const confidence = Math.round(components.reduce((total, component) => {
      if (component.value === null) return total;
      const factorEvidence = evidenceByFactor.get(component.factor) ?? [];
      const factorConfidence = factorEvidence.length > 0
        ? factorEvidence.reduce((sum, item) => sum + (item.confidence ?? 1), 0) / factorEvidence.length
        : 0.5;
      return total + component.weight * Math.min(1, Math.max(0, factorConfidence));
    }, 0) * 100) / 100;
    const evidenceUsed = components
      .filter(({ value }) => value !== null)
      .map(({ factor, classification, sources }) => ({ factor, classification, sources }));
    const risks = [
      ...(idea.estimatedEffort !== null && idea.estimatedEffort >= 4
        ? ['Esforço de produção estimado alto.']
        : []),
      ...components
        .filter(({ value }) => value !== null && value < 40)
        .map(({ factor }) => `Sinal desfavorável em ${FACTOR_LABELS[factor]}.`),
      ...(research.length === 0 ? ['Sem evidência histórica real para esta ideia.'] : []),
    ];

    return {
      ideaId: idea.id,
      score,
      category,
      classification: 'recommendation',
      rationale,
      components,
      unknownFactors,
      confidence,
      evidenceUsed,
      risks,
      missingData: [...unknownFactors],
    };
  }

  rank(evaluations: readonly IdeaEvaluation[]): RankedIdeaEvaluation[] {
    return [...evaluations]
      .sort((left, right) => right.score - left.score || left.ideaId.localeCompare(right.ideaId))
      .map((evaluation, index, ranked) => ({
        ...evaluation,
        rank: index + 1,
        rankingRationale: index === 0
          ? `Primeira posição por apresentar o maior score relativo (${evaluation.score.toFixed(1)}).`
          : `Posição ${index + 1}: ${evaluation.score.toFixed(1)} pontos, ${(
            ranked[0].score - evaluation.score
          ).toFixed(1)} abaixo da primeira ideia.`,
      }));
  }
}
