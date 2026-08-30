import { createHash } from 'crypto';
import type {
  ContentPattern,
  EditorialDecision,
  PerformanceSignal,
  Prisma,
  TrendSignal,
  VideoPerformanceSnapshot,
} from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { ConversationRepository } from '../../database/repositories/ConversationRepository';
import { DecisionHistoryRepository } from '../../database/repositories/DecisionHistoryRepository';
import { EditorialDecisionRepository } from '../../database/repositories/EditorialDecisionRepository';
import { PerformanceSignalRepository } from '../../database/repositories/PerformanceSignalRepository';
import { VideoPerformanceSnapshotRepository } from '../../database/repositories/VideoPerformanceSnapshotRepository';
import type { RankedIdeaEvaluation } from '../../domains/creator-intelligence/types';
import {
  EDITORIAL_CANDIDATE_TYPES,
  OpportunityScoringService,
  type DecisionConstraint,
  type DecisionEvidence,
  type DecisionRisk,
  type EditorialCandidate,
  type OpportunityFactor,
  type RankedEditorialCandidate,
} from '../../domains/editorial-decision';
import { CreatorIntelligenceService } from './CreatorIntelligenceService';
import { ChannelOperatorService } from '../channel-operators';
import type { ChannelOperatorAnalysis } from '../../domains/channel-operators/types';
import { ContentPatternIntelligenceService, SeriesIntelligenceService, TrendIntelligenceService } from '../trend-intelligence';

export const EDITORIAL_DECISION_INTENTS = [
  'next_content',
  'compare_ideas',
  'diagnose_performance',
  'continue_series',
  'improve_next',
  'general_editorial',
  'trend_analysis',
] as const;

export type EditorialDecisionIntent = (typeof EDITORIAL_DECISION_INTENTS)[number];

export interface GenerateEditorialDecisionInput {
  question: string;
  projectId?: string | null;
  conversationId?: string | null;
  ideaIds?: readonly string[];
  videoId?: string | null;
  candidates?: readonly EditorialCandidate[];
  researchOpportunities?: readonly ResearchDecisionInput[];
}

export interface ResearchDecisionInput {
  key: string;
  subject: string;
  subjectType: string;
  state: string;
  summary: string;
  sources: readonly string[];
  freshness: string;
  compatibility: number;
  confidence: number;
  evidence: ReadonlyArray<{ sourceId: string; classification: string; summary: string; confidence: number }>;
  risks: readonly string[];
  gaps: readonly string[];
  nextInvestigation: string;
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
  if (/tendenc|crescendo|subindo|caindo|qual formato.*resultado|qual serie.*(forte|caindo)/.test(text)) return 'trend_analysis';
  if (/continuar.*serie|vale.*serie|essa serie|pausar.*serie|risco.*serie/.test(text)) return 'continue_series';
  if (/o que.*mudar|melhorar|proximo video|onde.*risco|deve.*paus/.test(text)) return 'improve_next';
  if (/o que.*gravar|vale gravar|jogo.*testar|vale testar|gravar agora|maior oportunidade|qual jogo|qual formato|maior confianca/.test(text)) return 'next_content';
  return 'general_editorial';
};

export const isEditorialQuestion = (question: string): boolean =>
  classifyEditorialIntent(question) !== 'general_editorial'
  || /(pesquis|procure|investigue|oportunidade|lacuna|tema surgindo|fora do meu canal|o que.*gravo hoje|fila editorial|plano editorial|o que vem depois|planej|calendario editorial|o que estamos testando|experimento|hipotese|resultado do teste)/i.test(question);

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

const normalizeCandidate = (candidate: EditorialCandidate): EditorialCandidate => {
  const key = candidate.key?.trim();
  const label = candidate.label?.trim();
  if (!key || !label || key.length > 160 || label.length > 200) {
    throw new EditorialDecisionValidationError('candidate key and label are required and bounded');
  }
  if (!EDITORIAL_CANDIDATE_TYPES.includes(candidate.type)) {
    throw new EditorialDecisionValidationError('invalid candidate type');
  }
  const optional = (value: string | undefined) => value?.trim() || undefined;
  return {
    key,
    label,
    type: candidate.type,
    ideaId: optional(candidate.ideaId),
    game: optional(candidate.game),
    topic: optional(candidate.topic),
    format: optional(candidate.format),
    seriesId: optional(candidate.seriesId),
  };
};

const candidateTerms = (candidate: EditorialCandidate): string[] => [
  candidate.key,
  candidate.label,
  candidate.game,
  candidate.topic,
  candidate.format,
  candidate.seriesId,
].flatMap((value) => value ? [searchable(value)] : []);

const matchesCandidate = (candidate: EditorialCandidate, value: string): boolean =>
  candidateTerms(candidate).includes(searchable(value));

const trendValue = (classification: string): number | null => ({
  RISING: 80,
  DECLINING: 25,
  STABLE: 55,
  VOLATILE: 42,
  INSUFFICIENT_DATA: null,
}[classification] ?? null);

const seriesValue = (health: string): number | null => ({
  STRONG: 85,
  HEALTHY: 65,
  DECLINING: 28,
  VOLATILE: 40,
  DORMANT: 30,
  INSUFFICIENT_DATA: null,
}[health] ?? null);

const patternValue = (classification: string): number | null => ({
  STRONG: 78,
  NEUTRAL: 52,
  WEAK: 30,
  INSUFFICIENT_DATA: null,
}[classification] ?? null);

const operatorValue = (analysis: ChannelOperatorAnalysis | null): number | null => {
  if (!analysis || analysis.sampleSize === 0 || analysis.status === 'NOT_CONFIGURED') return null;
  const positive = analysis.signals.filter(({ direction }) => direction === 'positive').length;
  const negative = analysis.signals.filter(({ direction }) => direction === 'negative').length;
  if (positive > negative) return 68;
  if (negative > positive) return 32;
  return 50;
};

const factor = (
  id: OpportunityFactor['id'],
  value: number | null,
  confidence: number,
  quality: string,
  source: string,
  summary: string,
  classification: OpportunityFactor['classification'] = 'fact',
): OpportunityFactor => ({ id, value, confidence, quality, source, summary, classification });

interface OpportunitySourceBundle {
  ranking: RankedIdeaEvaluation[];
  signals: PerformanceSignal[];
  trends: TrendSignal[];
  series: Array<{ series: { id: string; name: string }; health: { health: string; confidence: number; missingData?: string[]; reasons?: string[] } }>;
  patterns: ContentPattern[];
  ctr: ChannelOperatorAnalysis | null;
  retention: ChannelOperatorAnalysis | null;
  longForm: ChannelOperatorAnalysis | null;
  shorts: ChannelOperatorAnalysis | null;
}

const factorsForCandidate = (
  candidate: EditorialCandidate,
  sources: OpportunitySourceBundle,
): { factors: OpportunityFactor[]; constraints: DecisionConstraint[]; risks: DecisionRisk[] } => {
  const factors: OpportunityFactor[] = [];
  const evaluation = sources.ranking.find(({ ideaId }) => ideaId === candidate.ideaId || ideaId === candidate.key);
  if (evaluation) {
    factors.push(factor('HISTORICAL_PERFORMANCE', evaluation.score, evaluation.confidence, 'GOOD',
      `idea-ranking:${evaluation.ideaId}`, evaluation.rationale, 'inference'));
    factors.push(factor('EDITORIAL_FIT', evaluation.score, evaluation.confidence, 'AVAILABLE',
      `idea-evaluation:${evaluation.ideaId}`, evaluation.rankingRationale, 'inference'));
  }
  const matchedTrend = sources.trends.filter(({ subject }) => matchesCandidate(candidate, subject))
    .sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id))[0];
  if (matchedTrend) factors.push(factor('TREND', trendValue(matchedTrend.classification), matchedTrend.confidence,
    (matchedTrend.quality as { state?: string })?.state ?? 'PARTIAL', `trend:${matchedTrend.id}`,
    `${matchedTrend.subject}: ${matchedTrend.classification} na janela comparável.`, 'fact'));
  const matchedSeries = sources.series.find(({ series }) => series.id === candidate.seriesId || matchesCandidate(candidate, series.name));
  if (matchedSeries) factors.push(factor('SERIES_HEALTH', seriesValue(matchedSeries.health.health), matchedSeries.health.confidence,
    matchedSeries.health.health === 'INSUFFICIENT_DATA' ? 'PARTIAL' : 'GOOD', `series:${matchedSeries.series.id}`,
    `${matchedSeries.series.name}: saúde ${matchedSeries.health.health}.`, 'inference'));
  const matchedPattern = sources.patterns.filter(({ subject }) => matchesCandidate(candidate, subject))
    .sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id))[0];
  if (matchedPattern) factors.push(factor('HISTORICAL_PERFORMANCE', patternValue(matchedPattern.classification), matchedPattern.confidence,
    (matchedPattern.quality as { state?: string })?.state ?? 'PARTIAL', `content-pattern:${matchedPattern.id}`,
    matchedPattern.summary, 'inference'));
  const formatAnalysis = candidate.format && /short/i.test(candidate.format) ? sources.shorts
    : candidate.format ? sources.longForm : null;
  if (formatAnalysis) {
    factors.push(factor('FORMAT_FIT', operatorValue(formatAnalysis), formatAnalysis.confidence,
      formatAnalysis.quality?.state ?? formatAnalysis.status, `channel-operator:${formatAnalysis.id}`,
      formatAnalysis.signals[0]?.summary ?? `${formatAnalysis.name}: ${formatAnalysis.sampleSize} itens comparáveis.`, 'inference'));
    factors.push(factor('AUDIENCE_RESPONSE', operatorValue(formatAnalysis), formatAnalysis.confidence,
      formatAnalysis.quality?.state ?? formatAnalysis.status, `channel-operator:${formatAnalysis.id}:audience`,
      formatAnalysis.insights[0] ?? 'Resposta de audiência por formato ainda é limitada.', 'inference'));
  }
  for (const [id, analysis] of [['CTR', sources.ctr], ['RETENTION', sources.retention]] as const) {
    if (!analysis) continue;
    factors.push(factor(id, operatorValue(analysis), analysis.confidence, analysis.quality?.state ?? analysis.status,
      `channel-operator:${analysis.id}`, analysis.signals[0]?.summary ?? `${analysis.name}: ${analysis.sampleSize} itens comparáveis.`, 'inference'));
  }
  const candidateSignal = (metric: string): PerformanceSignal | undefined => sources.signals
    .filter((signal) => {
      if (signal.metric !== metric) return false;
      if (candidate.ideaId && signal.videoIdeaId === candidate.ideaId) return true;
      const scoped = [signal.game, signal.series, signal.format].some(Boolean);
      if (!scoped) return true;
      return (!signal.game || Boolean(candidate.game && searchable(signal.game) === searchable(candidate.game)))
        && (!signal.series || Boolean(candidate.seriesId && searchable(signal.series) === searchable(candidate.seriesId)))
        && (!signal.format || Boolean(candidate.format && searchable(signal.format) === searchable(candidate.format)));
    })
    .sort((left, right) => right.confidence - left.confidence
      || right.measuredAt.getTime() - left.measuredAt.getTime()
      || left.id.localeCompare(right.id))[0];
  for (const [id, metric] of [['WATCH_TIME', 'watch_time_performance'], ['SUBSCRIBER_GAIN', 'subscriber_conversion']] as const) {
    const signal = candidateSignal(metric);
    if (!signal) continue;
    factors.push(factor(id, signal.value, signal.confidence,
      signal.classification === 'real' ? 'GOOD' : 'AVAILABLE', `performance-signal:${signal.id}`,
      `${metric}: score relativo ${signal.value}/100 contra a baseline interna.`, 'fact'));
  }
  const constraints: DecisionConstraint[] = [
    ...(evaluation?.missingData ?? []).map((item) => ({ code: `MISSING_${String(item).toUpperCase()}`, summary: String(item) })),
  ];
  const risks: DecisionRisk[] = [
    ...(evaluation?.risks ?? []).map((summary, index) => ({ code: `IDEA_RISK_${index + 1}`, severity: 'MEDIUM' as const, summary, source: `idea:${evaluation?.ideaId ?? candidate.key}` })),
  ];
  return { factors, constraints, risks };
};

export class EditorialDecisionService {
  private decisionRepository?: EditorialDecisionRepository;
  private conversationRepository?: ConversationRepository;
  private snapshotRepository?: VideoPerformanceSnapshotRepository;
  private signalRepository?: PerformanceSignalRepository;
  private readonly channelOperators: Pick<ChannelOperatorService, 'run'>;
  private readonly trendIntelligence: Pick<TrendIntelligenceService, 'list'>;
  private readonly seriesIntelligence: Pick<SeriesIntelligenceService, 'list'>;
  private readonly contentPatterns: Pick<ContentPatternIntelligenceService, 'list'>;
  private readonly opportunityScoring: OpportunityScoringService;

  constructor(
    private readonly intelligence = new CreatorIntelligenceService(),
    decisionRepository?: EditorialDecisionRepository,
    conversationRepository?: ConversationRepository,
    snapshotRepository?: VideoPerformanceSnapshotRepository,
    signalRepository?: PerformanceSignalRepository,
    channelOperators: Pick<ChannelOperatorService, 'run'> = new ChannelOperatorService(),
    trendIntelligence: Pick<TrendIntelligenceService, 'list'> = new TrendIntelligenceService(),
    seriesIntelligence: Pick<SeriesIntelligenceService, 'list'> = new SeriesIntelligenceService(),
    contentPatterns: Pick<ContentPatternIntelligenceService, 'list'> = new ContentPatternIntelligenceService(),
    opportunityScoring = new OpportunityScoringService(),
  ) {
    this.decisionRepository = decisionRepository;
    this.conversationRepository = conversationRepository;
    this.snapshotRepository = snapshotRepository;
    this.signalRepository = signalRepository;
    this.channelOperators = channelOperators;
    this.trendIntelligence = trendIntelligence;
    this.seriesIntelligence = seriesIntelligence;
    this.contentPatterns = contentPatterns;
    this.opportunityScoring = opportunityScoring;
  }

  private get decisions(): EditorialDecisionRepository {
    if (!this.decisionRepository) {
      this.decisionRepository = new DecisionHistoryRepository(DatabaseService.client);
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
    const suppliedCandidates = (input.candidates ?? []).map(normalizeCandidate);
    if (suppliedCandidates.length > 20) throw new EditorialDecisionValidationError('candidates accepts at most 20 items');
    if (new Set(suppliedCandidates.map(({ key }) => key)).size !== suppliedCandidates.length) {
      throw new EditorialDecisionValidationError('candidate keys must be unique');
    }
    const researchOpportunities = (input.researchOpportunities ?? []).slice(0, 20);
    const researchCandidates = researchOpportunities.map((opportunity) => normalizeCandidate({
      key: opportunity.key,
      label: opportunity.subject,
      type: opportunity.subjectType === 'GAME' || opportunity.subjectType === 'SIMULATOR' || opportunity.subjectType === 'CAR'
        ? 'GAME' : opportunity.subjectType === 'SERIES' ? 'SERIES' : opportunity.subjectType === 'FORMAT' ? 'FORMAT' : 'TOPIC',
      ...(opportunity.subjectType === 'GAME' ? { game: opportunity.subject } : {}),
      ...(opportunity.subjectType === 'TOPIC' ? { topic: opportunity.subject } : {}),
      ...(opportunity.subjectType === 'FORMAT' ? { format: opportunity.subject } : {}),
    }));
    const videoId = input.videoId?.trim() || null;
    const intent = classifyEditorialIntent(question, Math.max(ideaIds.length, suppliedCandidates.length));
    const normalizedQuestionKey = searchable(question).replace(/\s+/g, ' ').trim();
    const [context, recommendation, baseline, allSignals, learnings, allSnapshots, previousEditorialDecisions,
      ctrAnalysis, retentionAnalysis, longFormAnalysis, shortsAnalysis, temporalTrends, seriesAnalyses, contentPatterns] = await Promise.all([
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
      this.channelOperators.run('retention', projectId).catch(() => null),
      this.channelOperators.run('long-form', projectId).catch(() => null),
      this.channelOperators.run('shorts', projectId).catch(() => null),
      this.trendIntelligence.list({ projectId, days: 28 }).catch(() => []),
      this.seriesIntelligence.list(projectId).catch(() => []),
      this.contentPatterns.list({ projectId }).catch(() => []),
    ]);
    const snapshots = videoId ? allSnapshots.filter((snapshot) => snapshot.videoId === videoId) : allSnapshots;
    const ranking = recommendation.ranking.slice(0, 5);
    const top = suppliedCandidates.length > 0 || researchCandidates.length > 0 ? undefined : ranking[0];
    const latest = snapshots[0];
    const candidates = suppliedCandidates.length > 0
      ? suppliedCandidates
      : researchCandidates.length > 0
        ? researchCandidates
      : ranking.length > 0
        ? ranking.map((item) => {
          const idea = context.ideas.find(({ id }) => id === item.ideaId);
          return normalizeCandidate({
            key: item.ideaId,
            label: idea?.premise || idea?.theme || item.ideaId,
            type: 'IDEA',
            ideaId: item.ideaId,
            game: idea?.game ?? undefined,
            format: idea?.format ?? undefined,
          });
        })
        : intent === 'continue_series' && seriesAnalyses.length > 0
          ? seriesAnalyses.map(({ series }) => normalizeCandidate({ key: series.id, label: series.name, type: 'SERIES', seriesId: series.id }))
          : [normalizeCandidate({ key: 'current-opportunity', label: 'Oportunidade editorial atual', type: 'TOPIC' })];
    const opportunityRanking = this.opportunityScoring.rank(candidates.map((candidate) => {
      const researchOpportunity = researchOpportunities.find(({ key }) => key === candidate.key);
      const base = factorsForCandidate(candidate, {
        ranking,
        signals: allSignals,
        trends: temporalTrends,
        series: seriesAnalyses,
        patterns: contentPatterns,
        ctr: ctrAnalysis,
        retention: retentionAnalysis,
        longForm: longFormAnalysis,
        shorts: shortsAnalysis,
      });
      return {
        candidate,
        factors: [
          ...base.factors,
          ...(researchOpportunity ? [factor(
            'EDITORIAL_FIT', researchOpportunity.compatibility * 100, researchOpportunity.confidence,
            researchOpportunity.freshness === 'STALE' ? 'STALE' : 'PARTIAL',
            `research:${researchOpportunity.key}`, researchOpportunity.summary, 'inference',
          )] : []),
        ],
        constraints: [...base.constraints, ...(researchOpportunity?.gaps ?? []).map((summary, index) => ({ code: `RESEARCH_GAP_${index + 1}`, summary }))],
        risks: [...base.risks, ...(researchOpportunity?.risks ?? []).map((summary, index) => ({ code: `RESEARCH_RISK_${index + 1}`, severity: 'MEDIUM' as const, summary, source: `research:${researchOpportunity?.key ?? candidate.key}` }))],
      };
    }));
    const topOpportunity = opportunityRanking[0];

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
    for (const opportunity of researchOpportunities.slice(0, 5)) {
      evidence.push({
        classification: 'inference', source: `research:${opportunity.key}`,
        summary: `${opportunity.summary} Fonte(s): ${opportunity.sources.join(', ') || 'não informada'}. Freshness: ${opportunity.freshness}.`,
        confidence: opportunity.confidence,
      });
    }
    const relevantTrends = temporalTrends
      .filter(({ classification }) => classification !== 'INSUFFICIENT_DATA')
      .sort((left, right) => {
        const leftRelevant = top && [top.ideaId, context.ideas.find(({ id }) => id === top.ideaId)?.game, context.ideas.find(({ id }) => id === top.ideaId)?.format]
          .filter(Boolean).some((value) => searchable(String(value)) === searchable(left.subject));
        const rightRelevant = top && [top.ideaId, context.ideas.find(({ id }) => id === top.ideaId)?.game, context.ideas.find(({ id }) => id === top.ideaId)?.format]
          .filter(Boolean).some((value) => searchable(String(value)) === searchable(right.subject));
        return Number(rightRelevant) - Number(leftRelevant) || right.confidence - left.confidence;
      }).slice(0, 4);
    for (const trend of relevantTrends) {
      evidence.push({ classification: 'inference', source: `trend:${trend.id}`,
        summary: `${trend.subject} · ${trend.metric}: ${trend.classification} em janelas equivalentes (${trend.sampleSize} observações).`,
        confidence: trend.confidence });
    }
    for (const item of seriesAnalyses.filter(({ health }) => health.health !== 'INSUFFICIENT_DATA').slice(0, 3)) {
      evidence.push({ classification: 'inference', source: `series:${item.series.id}`,
        summary: `${item.series.name}: saúde ${item.health.health}, tendência ${item.health.trend}, amostra ${item.health.sampleSize}.`,
        confidence: item.health.confidence });
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

    const text = (suppliedCandidates.length > 0 || researchCandidates.length > 0) && topOpportunity
      ? {
        recommendation: `${topOpportunity.candidate.label} apresenta a maior oportunidade relativa entre os candidatos avaliados (${topOpportunity.opportunity.category}, ${topOpportunity.opportunity.value}/100).`,
        nextAction: `Valide os dados ausentes de ${topOpportunity.candidate.label} e execute um teste proporcional à confiança disponível.`,
      }
      : recommendationText(intent, top, latest);
    const missingData = new Set<string>(top?.missingData ?? []);
    if (baseline.views.sampleSize === 0) missingData.add('baseline de performance');
    if (allSignals.length === 0) missingData.add('sinais de performance');
    if (learnings.length === 0) missingData.add('memória do canal');
    if (ranking.length === 0) missingData.add('ideias cadastradas');
    if (videoId && snapshots.length === 0) missingData.add('performance do vídeo solicitado');
    if (!ctrAnalysis?.sampleSize) missingData.add('alcance e CTR oficiais');
    if (!relevantTrends.length) missingData.add('tendências com janelas equivalentes suficientes');
    if (!seriesAnalyses.some(({ health }) => health.health !== 'INSUFFICIENT_DATA')) missingData.add('séries com episódios comparáveis');
    const risks = [...new Set([
      ...(top?.risks ?? []),
      ...(baseline.views.sampleSize > 0 && baseline.views.sampleSize < 3 ? ['A baseline ainda possui amostra pequena.'] : []),
      ...(ctrAnalysis?.quality && ctrAnalysis.quality.state !== 'GOOD' ? [`Qualidade de alcance: ${ctrAnalysis.quality.state}.`] : []),
      'Desempenho histórico não garante resultado futuro.',
    ])];
    const legacyConfidence = confidenceAverage([
      ...(top ? [top.confidence] : []),
      ...evidence.filter(({ classification }) => classification !== 'recommendation').map(({ confidence: value }) => value),
    ]);
    const opportunityHasEvidence = topOpportunity?.opportunity.components.some(({ value }) => value !== null) ?? false;
    const confidence = opportunityHasEvidence ? topOpportunity!.opportunity.confidence : legacyConfidence;
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
      opportunityRanking: opportunityRanking.map(({ candidate, opportunity }) => [candidate.key, opportunity.value, opportunity.category, opportunity.confidence]),
      trends: relevantTrends.map(({ id, detectedAt, classification }) => [id, detectedAt, classification]),
      series: seriesAnalyses.slice(0, 10).map(({ series, health }) => [series.id, health.health, health.sampleSize]),
      research: researchOpportunities.map(({ key, state, confidence, freshness }) => [key, state, confidence, freshness]),
    });
    const existing = await this.decisions.findByDedupeKey(dedupeKey);
    if (existing) return { decision: existing, created: false };

    try {
      const legacyAlternatives = ranking.slice(1, 4).map((item) => ({
        ideaId: item.ideaId,
        rank: item.rank,
        score: item.score,
        confidence: item.confidence,
        rationale: item.rationale,
        opportunity: opportunityRanking.find(({ candidate }) => candidate.ideaId === item.ideaId)?.opportunity,
      }));
      const candidateAlternatives = opportunityRanking.slice(1, 4).map(({ rank, candidate, opportunity }) => ({
        rank,
        candidateKey: candidate.key,
        label: candidate.label,
        type: candidate.type,
        score: opportunity.value,
        confidence: opportunity.confidence,
        category: opportunity.category,
        rationale: opportunity.rationale,
      }));
      const persistedAlternatives = suppliedCandidates.length > 0 || researchCandidates.length > 0 || ranking.length === 0
        ? candidateAlternatives
        : legacyAlternatives;
      const decision = await this.decisions.create({
        projectId,
        conversationId,
        dedupeKey,
        question,
        intent,
        recommendation: text.recommendation,
        alternatives: persistedAlternatives as unknown as Prisma.InputJsonValue,
        score: opportunityHasEvidence ? topOpportunity!.opportunity.value : top?.score ?? null,
        confidence,
        classification: 'recommendation',
        category: topOpportunity?.opportunity.category ?? 'INSUFFICIENT_DATA',
        candidateType: topOpportunity?.candidate.type ?? null,
        candidateKey: topOpportunity?.candidate.key ?? null,
        opportunityScore: topOpportunity!.opportunity as unknown as Prisma.InputJsonValue,
        favorableEvidence: (topOpportunity?.opportunity.favorableEvidence ?? []) as unknown as Prisma.InputJsonValue,
        contraryEvidence: (topOpportunity?.opportunity.contraryEvidence ?? []) as unknown as Prisma.InputJsonValue,
        constraints: (topOpportunity?.opportunity.constraints ?? []) as unknown as Prisma.InputJsonValue,
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

  async compareCandidates(input: {
    question?: string;
    projectId?: string | null;
    conversationId?: string | null;
    candidates: readonly EditorialCandidate[];
  }): Promise<EditorialDecisionResult> {
    if (!Array.isArray(input.candidates) || input.candidates.length < 2 || input.candidates.length > 20) {
      throw new EditorialDecisionValidationError('candidates must contain between 2 and 20 items');
    }
    return this.generate({
      question: input.question?.trim() || 'Qual destes candidatos apresenta a melhor oportunidade editorial agora?',
      projectId: input.projectId,
      conversationId: input.conversationId,
      candidates: input.candidates,
    });
  }

  async getCurrent(input: { projectId?: string | null; conversationId?: string | null } = {}): Promise<EditorialDecision | null> {
    return (await this.decisions.findAll({
      ...('projectId' in input ? { projectId: input.projectId?.trim() || null } : {}),
      ...('conversationId' in input ? { conversationId: input.conversationId?.trim() || null } : {}),
      limit: 1,
    }))[0] ?? null;
  }

  async listOpportunities(input: { projectId?: string | null; conversationId?: string | null; limit?: number } = {}): Promise<EditorialDecision[]> {
    const limit = input.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new EditorialDecisionValidationError('limit must be an integer from 1 to 50');
    }
    return this.decisions.findAll({
      ...('projectId' in input ? { projectId: input.projectId?.trim() || null } : {}),
      ...('conversationId' in input ? { conversationId: input.conversationId?.trim() || null } : {}),
      categories: ['PRIORITIZE', 'CONTINUE', 'TEST'],
      limit,
    });
  }

  async listRisks(input: { projectId?: string | null; conversationId?: string | null; limit?: number } = {}): Promise<EditorialDecision[]> {
    const limit = input.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new EditorialDecisionValidationError('limit must be an integer from 1 to 50');
    }
    const rows = await this.decisions.findAll({
      ...('projectId' in input ? { projectId: input.projectId?.trim() || null } : {}),
      ...('conversationId' in input ? { conversationId: input.conversationId?.trim() || null } : {}),
      limit: 50,
    });
    return rows.filter((decision) => (Array.isArray(decision.risks) && decision.risks.length > 0)
      || ['PAUSE', 'REEVALUATE', 'INSUFFICIENT_DATA'].includes(decision.category)).slice(0, limit);
  }

  async getEvidence(id: string) {
    const decision = await this.getById(id);
    if (!decision) return null;
    const opportunity = decision.opportunityScore && typeof decision.opportunityScore === 'object'
      && !Array.isArray(decision.opportunityScore)
      ? decision.opportunityScore as Record<string, Prisma.JsonValue>
      : null;
    const structuredRisks = jsonArray<DecisionRisk>(opportunity?.risks ?? []);
    const legacyRisks = jsonArray<unknown>(decision.risks).flatMap((risk, index) => (
      typeof risk === 'string'
        ? [{ code: `LEGACY_RISK_${index + 1}`, severity: 'MEDIUM' as const, summary: risk }]
        : []
    ));
    return {
      decisionId: decision.id,
      category: decision.category,
      score: decision.score,
      confidence: decision.confidence,
      evidence: jsonArray<EditorialEvidenceItem>(decision.evidence),
      favorableEvidence: jsonArray<DecisionEvidence>(decision.favorableEvidence),
      contraryEvidence: jsonArray<DecisionEvidence>(decision.contraryEvidence),
      risks: structuredRisks.length > 0 ? structuredRisks : legacyRisks,
      constraints: jsonArray<DecisionConstraint>(decision.constraints),
      missingData: jsonArray<string>(decision.missingData),
      opportunityScore: decision.opportunityScore,
    };
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
  favorableEvidence: jsonArray<DecisionEvidence>(decision.favorableEvidence),
  contraryEvidence: jsonArray<DecisionEvidence>(decision.contraryEvidence),
  constraints: jsonArray<DecisionConstraint>(decision.constraints),
});
