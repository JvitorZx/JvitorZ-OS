import { createHash } from 'crypto';
import type {
  EditorialDecision,
  Prisma,
  VideoPerformanceSnapshot,
} from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { ConversationRepository } from '../../database/repositories/ConversationRepository';
import { EditorialDecisionRepository } from '../../database/repositories/EditorialDecisionRepository';
import { PerformanceSignalRepository } from '../../database/repositories/PerformanceSignalRepository';
import { VideoPerformanceSnapshotRepository } from '../../database/repositories/VideoPerformanceSnapshotRepository';
import type { RankedIdeaEvaluation } from '../../domains/creator-intelligence/types';
import { CreatorIntelligenceService } from './CreatorIntelligenceService';
import { ChannelOperatorService } from '../channel-operators';

export const EDITORIAL_DECISION_INTENTS = [
  'next_content',
  'compare_ideas',
  'diagnose_performance',
  'continue_series',
  'improve_next',
  'general_editorial',
] as const;

export type EditorialDecisionIntent = (typeof EDITORIAL_DECISION_INTENTS)[number];

export interface GenerateEditorialDecisionInput {
  question: string;
  projectId?: string | null;
  conversationId?: string | null;
  ideaIds?: readonly string[];
  videoId?: string | null;
}

export interface EditorialEvidenceItem {
  classification: 'fact' | 'inference' | 'recommendation';
  source: string;
  summary: string;
  confidence: number;
}

export interface EditorialDecisionResult {
  decision: EditorialDecision;
  created: boolean;
}

export class EditorialDecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditorialDecisionError';
  }
}

export class EditorialDecisionValidationError extends EditorialDecisionError {
  constructor(message: string) {
    super(message);
    this.name = 'EditorialDecisionValidationError';
  }
}

export class EditorialDecisionNotFoundError extends EditorialDecisionError {
  constructor(message = 'Editorial decision not found') {
    super(message);
    this.name = 'EditorialDecisionNotFoundError';
  }
}

export class EditorialDecisionConversationNotFoundError extends EditorialDecisionError {
  constructor() {
    super('Conversation not found');
    this.name = 'EditorialDecisionConversationNotFoundError';
  }
}

export class EditorialDecisionSnapshotNotFoundError extends EditorialDecisionError {
  constructor() {
    super('Performance snapshot not found');
    this.name = 'EditorialDecisionSnapshotNotFoundError';
  }
}

const normalizeQuestion = (question: string): string => {
  const normalized = question.trim();
  if (!normalized) throw new EditorialDecisionValidationError('question is required');
  if (Array.from(normalized).length > 1_000) {
    throw new EditorialDecisionValidationError('question is too long');
  }
  return normalized;
};

const searchable = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

export const classifyEditorialIntent = (
  question: string,
  ideaCount = 0,
): EditorialDecisionIntent => {
  const text = searchable(question);
  if (ideaCount > 1 || /qual dessas|compar|melhor ideia/.test(text)) return 'compare_ideas';
  if (/por que|porque|foi fraco|desempenho|performance|ultimo teste|deu certo|ainda funciona/.test(text)) return 'diagnose_performance';
  if (/continuar.*serie|vale.*serie|essa serie/.test(text)) return 'continue_series';
  if (/o que.*mudar|melhorar|proximo video/.test(text)) return 'improve_next';
  if (/o que.*gravar|vale gravar|jogo.*testar|vale testar|gravar agora/.test(text)) return 'next_content';
  return 'general_editorial';
};

export const isEditorialQuestion = (question: string): boolean =>
  classifyEditorialIntent(question) !== 'general_editorial';

const isUniqueConstraintError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';

const jsonArray = <T>(value: Prisma.JsonValue): T[] => Array.isArray(value) ? value as T[] : [];

const metricText = (snapshot: VideoPerformanceSnapshot): string => {
  const metrics = [
    snapshot.views === null ? null : `${snapshot.views} views`,
    snapshot.averageViewPercentage === null ? null : `${snapshot.averageViewPercentage}% de retenção média`,
    snapshot.watchTimeMinutes === null ? null : `${snapshot.watchTimeMinutes} min de watch time`,
  ].filter(Boolean);
  return metrics.length > 0 ? metrics.join(', ') : 'sem métricas disponíveis';
};

const confidenceAverage = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;
};

const decisionFingerprint = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const recommendationText = (
  intent: EditorialDecisionIntent,
  top: RankedIdeaEvaluation | undefined,
  latest: VideoPerformanceSnapshot | undefined,
): { recommendation: string; nextAction: string } => {
  if (intent === 'diagnose_performance') {
    return {
      recommendation: latest
        ? 'Use o desempenho observado como diagnóstico, priorizando as métricas abaixo da baseline antes de repetir a fórmula.'
        : 'Use os outcomes e aprendizados disponíveis como diagnóstico; sem métricas comparáveis, mantenha a conclusão inconclusiva.',
      nextAction: latest
        ? 'Compare retenção, watch time e conversão do conteúdo com a baseline antes de definir a próxima mudança.'
        : 'Vincule a decisão ao vídeo publicado e sincronize dados suficientes antes de concluir se o teste funcionou.',
    };
  }
  if (intent === 'continue_series') {
    return {
      recommendation: 'Faça um teste controlado antes de continuar a série em escala; os dados atuais não justificam uma promessa absoluta.',
      nextAction: 'Cadastre uma ideia concreta da série e compare seu formato com os sinais históricos disponíveis.',
    };
  }
  if (top) {
    if (intent === 'compare_ideas') {
      return {
        recommendation: `Priorize a ideia ${top.ideaId}, que lidera o ranking relativo com ${top.score}/100.`,
        nextAction: `Revise a premissa da ideia ${top.ideaId} e prepare um teste de produção proporcional à confiança disponível.`,
      };
    }
    return {
      recommendation: `A ideia ${top.ideaId} é a melhor opção disponível para o próximo teste editorial (${top.category}, ${top.score}/100).`,
      nextAction: `Transforme a ideia ${top.ideaId} em pauta e valide primeiro os dados ainda ausentes.`,
    };
  }
  return {
    recommendation: 'Ainda não há uma ideia cadastrada com evidência suficiente para uma recomendação específica.',
    nextAction: 'Cadastre ao menos uma ideia com tema, formato e premissa para obter um ranking editorial.',
  };
};

export class EditorialDecisionService {
  private decisionRepository?: EditorialDecisionRepository;
  private conversationRepository?: ConversationRepository;
  private snapshotRepository?: VideoPerformanceSnapshotRepository;
  private signalRepository?: PerformanceSignalRepository;
  private readonly channelOperators: Pick<ChannelOperatorService, 'run'>;

  constructor(
    private readonly intelligence = new CreatorIntelligenceService(),
    decisionRepository?: EditorialDecisionRepository,
    conversationRepository?: ConversationRepository,
    snapshotRepository?: VideoPerformanceSnapshotRepository,
    signalRepository?: PerformanceSignalRepository,
    channelOperators: Pick<ChannelOperatorService, 'run'> = new ChannelOperatorService(),
  ) {
    this.decisionRepository = decisionRepository;
    this.conversationRepository = conversationRepository;
    this.snapshotRepository = snapshotRepository;
    this.signalRepository = signalRepository;
    this.channelOperators = channelOperators;
  }

  private get decisions(): EditorialDecisionRepository {
    if (!this.decisionRepository) {
      this.decisionRepository = new EditorialDecisionRepository(DatabaseService.client);
    }
    return this.decisionRepository;
  }

  private get conversations(): ConversationRepository {
    if (!this.conversationRepository) {
      this.conversationRepository = new ConversationRepository(DatabaseService.client);
    }
    return this.conversationRepository;
  }

  private get snapshots(): VideoPerformanceSnapshotRepository {
    if (!this.snapshotRepository) {
      this.snapshotRepository = new VideoPerformanceSnapshotRepository(DatabaseService.client);
    }
    return this.snapshotRepository;
  }

  private get signals(): PerformanceSignalRepository {
    if (!this.signalRepository) {
      this.signalRepository = new PerformanceSignalRepository(DatabaseService.client);
    }
    return this.signalRepository;
  }

  async generate(input: GenerateEditorialDecisionInput): Promise<EditorialDecisionResult> {
    const question = normalizeQuestion(input.question);
    const conversationId = input.conversationId?.trim() || null;
    let projectId = input.projectId?.trim() || null;
    if (conversationId) {
      const conversation = await this.conversations.findById(conversationId);
      if (!conversation) throw new EditorialDecisionConversationNotFoundError();
      if (projectId && conversation.projectId !== projectId) {
        throw new EditorialDecisionValidationError('conversation does not belong to project');
      }
      projectId = conversation.projectId;
    }

    const ideaIds = [...new Set((input.ideaIds ?? []).map((id) => id.trim()).filter(Boolean))];
    if (ideaIds.length > 20) throw new EditorialDecisionValidationError('ideaIds accepts at most 20 ids');
    const videoId = input.videoId?.trim() || null;
    const intent = classifyEditorialIntent(question, ideaIds.length);
    const normalizedQuestionKey = searchable(question).replace(/\s+/g, ' ').trim();
    const [context, recommendation, baseline, allSignals, learnings, allSnapshots, previousEditorialDecisions, ctrAnalysis] = await Promise.all([
      this.intelligence.buildContext(projectId),
      ideaIds.length > 0
        ? this.intelligence.rankIdeas(ideaIds).then((ranking) => ({ recommendation: ranking[0] ?? null, ranking }))
        : this.intelligence.recommendEditorial(projectId),
      this.intelligence.getPerformanceBaseline(projectId),
      this.intelligence.listPerformanceSignals(projectId),
      this.intelligence.getChannelLearnings(projectId),
      this.intelligence.listPerformanceRecords(projectId),
      this.decisions.findAll({
        ...(conversationId ? { conversationId } : { projectId }),
        limit: 5,
      }),
      this.channelOperators.run('ctr', projectId).catch(() => null),
    ]);
    const snapshots = videoId ? allSnapshots.filter((snapshot) => snapshot.videoId === videoId) : allSnapshots;
    const ranking = recommendation.ranking.slice(0, 5);
    const top = ranking[0];
    const latest = snapshots[0];

    const evidence: EditorialEvidenceItem[] = [];
    if (baseline.views.median !== null) {
      evidence.push({
        classification: 'fact',
        source: 'channel-baseline',
        summary: `A baseline atual de views tem mediana ${baseline.views.median} em ${baseline.views.sampleSize} conteúdo(s).`,
        confidence: baseline.views.sampleSize >= 3 ? 1 : 0.5,
      });
    }
    if (ctrAnalysis?.sampleSize) {
      const ctrMedian = ctrAnalysis.facts.find(({ label }) => label === 'CTR mediano')?.value;
      evidence.push({
        classification: 'fact',
        source: 'youtube-reporting-reach',
        summary: `O alcance oficial possui ${ctrAnalysis.sampleSize} período(s) e CTR mediano ${ctrMedian ?? 'indisponível'}%. Qualidade: ${ctrAnalysis.quality?.state ?? 'desconhecida'}.`,
        confidence: ctrAnalysis.confidence,
      });
    }
    for (const snapshot of snapshots.slice(0, 3)) {
      evidence.push({
        classification: 'fact',
        source: `performance-snapshot:${snapshot.id}`,
        summary: `${snapshot.title}: ${metricText(snapshot)}.`,
        confidence: snapshot.confidence,
      });
    }
    for (const signal of allSignals.slice(0, 6)) {
      evidence.push({
        classification: 'fact',
        source: signal.source,
        summary: `${signal.metric}: score relativo ${signal.value}/100 contra a baseline interna.`,
        confidence: signal.confidence,
      });
    }
    for (const insight of learnings.slice(0, 5)) {
      evidence.push({
        classification: 'inference',
        source: `channel-memory:${insight.key}`,
        summary: insight.statement,
        confidence: insight.confidence,
      });
    }
    for (const previous of context.previousDecisions.slice(0, 3)) {
      evidence.push({
        classification: 'inference',
        source: `previous-decision:${previous.id}`,
        summary: `Decisão anterior ${previous.category} para a ideia ${previous.ideaId}: ${previous.rationale}`,
        confidence: 0.5,
      });
    }
    const relevantEditorialHistory = previousEditorialDecisions.filter((previous) => (
      searchable(previous.question).replace(/\s+/g, ' ').trim() !== normalizedQuestionKey
      || previous.outcome !== null
    )).slice(0, 3);
    for (const previous of relevantEditorialHistory) {
      const outcome = previous.outcome && typeof previous.outcome === 'object' && !Array.isArray(previous.outcome)
        ? previous.outcome as Record<string, unknown>
        : null;
      const assessment = typeof outcome?.assessment === 'string' ? ` Resultado: ${outcome.assessment}.` : '';
      evidence.push({
        classification: 'inference',
        source: `editorial-decision:${previous.id}`,
        summary: `Decisão editorial anterior: ${previous.recommendation}.${assessment}`,
        confidence: previous.confidence,
      });
    }
    if (top) {
      evidence.push({
        classification: 'recommendation',
        source: `idea-ranking:${top.ideaId}`,
        summary: top.rationale,
        confidence: top.confidence,
      });
    }

    const text = recommendationText(intent, top, latest);
    const missingData = new Set<string>(top?.missingData ?? []);
    if (baseline.views.sampleSize === 0) missingData.add('baseline de performance');
    if (allSignals.length === 0) missingData.add('sinais de performance');
    if (learnings.length === 0) missingData.add('memória do canal');
    if (ranking.length === 0) missingData.add('ideias cadastradas');
    if (videoId && snapshots.length === 0) missingData.add('performance do vídeo solicitado');
    if (!ctrAnalysis?.sampleSize) missingData.add('alcance e CTR oficiais');
    const risks = [...new Set([
      ...(top?.risks ?? []),
      ...(baseline.views.sampleSize > 0 && baseline.views.sampleSize < 3 ? ['A baseline ainda possui amostra pequena.'] : []),
      ...(ctrAnalysis?.quality && ctrAnalysis.quality.state !== 'GOOD' ? [`Qualidade de alcance: ${ctrAnalysis.quality.state}.`] : []),
      'Desempenho histórico não garante resultado futuro.',
    ])];
    const confidence = confidenceAverage([
      ...(top ? [top.confidence] : []),
      ...evidence.filter(({ classification }) => classification !== 'recommendation').map(({ confidence: value }) => value),
    ]);
    const alternatives = ranking.slice(1, 4).map((item) => ({
      ideaId: item.ideaId,
      rank: item.rank,
      score: item.score,
      confidence: item.confidence,
      rationale: item.rationale,
    }));
    const dedupeKey = decisionFingerprint({
      projectId,
      conversationId,
      question: normalizedQuestionKey,
      ideaIds,
      videoId,
      snapshots: snapshots.slice(0, 5).map(({ id, updatedAt }) => [id, updatedAt]),
      signals: allSignals.slice(0, 12).map(({ id, value }) => [id, value]),
      insights: learnings.slice(0, 10).map(({ key, updatedAt }) => [key, updatedAt]),
      previousDecisions: context.previousDecisions.slice(0, 10).map(({ id, score }) => [id, score]),
      previousEditorialDecisions: relevantEditorialHistory.map(({ id, updatedAt }) => [id, updatedAt]),
      ranking: ranking.map(({ ideaId, score }) => [ideaId, score]),
    });
    const existing = await this.decisions.findByDedupeKey(dedupeKey);
    if (existing) return { decision: existing, created: false };

    try {
      const decision = await this.decisions.create({
        projectId,
        conversationId,
        dedupeKey,
        question,
        intent,
        recommendation: text.recommendation,
        alternatives: alternatives as unknown as Prisma.InputJsonValue,
        score: top?.score ?? null,
        confidence,
        classification: 'recommendation',
        evidence: evidence as unknown as Prisma.InputJsonValue,
        risks: risks as Prisma.InputJsonValue,
        missingData: [...missingData] as Prisma.InputJsonValue,
        nextAction: text.nextAction,
      });
      return { decision, created: true };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const concurrent = await this.decisions.findByDedupeKey(dedupeKey);
        if (concurrent) return { decision: concurrent, created: false };
      }
      throw error;
    }
  }

  async list(input: {
    projectId?: string | null;
    conversationId?: string | null;
    limit?: number;
  } = {}): Promise<EditorialDecision[]> {
    const limit = input.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new EditorialDecisionValidationError('limit must be an integer from 1 to 50');
    }
    return this.decisions.findAll({
      ...('projectId' in input ? { projectId: input.projectId?.trim() || null } : {}),
      ...('conversationId' in input ? { conversationId: input.conversationId?.trim() || null } : {}),
      limit,
    });
  }

  async getById(id: string): Promise<EditorialDecision | null> {
    return this.decisions.findById(id.trim());
  }

  async attachOperatorMessage(id: string, messageId: string): Promise<EditorialDecision> {
    return this.decisions.attachOperatorMessage(id, messageId);
  }

  async registerOutcome(id: string, snapshotId: string): Promise<EditorialDecision> {
    const decision = await this.decisions.findById(id.trim());
    if (!decision) throw new EditorialDecisionNotFoundError();
    const snapshot = await this.snapshots.findById(snapshotId.trim());
    if (!snapshot) throw new EditorialDecisionSnapshotNotFoundError();
    if (decision.projectId !== snapshot.projectId) {
      throw new EditorialDecisionValidationError('snapshot does not belong to decision project');
    }
    const signals = await this.signals.findAll({ performanceSnapshotId: snapshot.id });
    const score = confidenceAverage(signals.map((signal) => signal.value / 100)) * 100;
    const assessment = signals.length === 0 ? 'unknown' : score >= 55 ? 'supported' : score < 45 ? 'contradicted' : 'mixed';
    const learning = assessment === 'supported'
      ? 'O resultado ficou acima da referência interna nas evidências disponíveis.'
      : assessment === 'contradicted'
        ? 'O resultado ficou abaixo da referência interna e a hipótese deve ser revista.'
        : assessment === 'mixed'
          ? 'O resultado foi misto e exige revisão por métrica antes de repetir a decisão.'
          : 'Ainda não existem sinais comparáveis suficientes para avaliar a decisão.';
    return this.decisions.registerOutcome(decision.id, snapshot.id, {
      assessment,
      learning,
      snapshotId: snapshot.id,
      videoId: snapshot.videoId,
      measuredAt: snapshot.collectedAt.toISOString(),
      signals: signals.map(({ id: signalId, metric, value, confidence }) => ({ signalId, metric, value, confidence })),
    });
  }
}

export const parseEditorialDecisionArrays = (decision: EditorialDecision) => ({
  alternatives: jsonArray<Record<string, unknown>>(decision.alternatives),
  evidence: jsonArray<EditorialEvidenceItem>(decision.evidence),
  risks: jsonArray<string>(decision.risks),
  missingData: jsonArray<string>(decision.missingData),
});
