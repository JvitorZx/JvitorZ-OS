import type {
  ContentDecision,
  ContentOpportunity,
  Prisma,
  VideoIdea,
} from '@prisma/client';
import type { ResearchProvider } from '../../domains/creator-intelligence/ResearchProvider';
import type {
  ContentDecisionCategory,
  CreatorIntelligenceContext,
  EvidenceClassification,
  IdeaEvaluation,
  RankedIdeaEvaluation,
  ResearchEvidence,
} from '../../domains/creator-intelligence/types';
import { DatabaseService } from '../../database/DatabaseService';
import { ChannelInsightRepository } from '../../database/repositories/ChannelInsightRepository';
import { ContentDecisionRepository } from '../../database/repositories/ContentDecisionRepository';
import { ContentOpportunityRepository } from '../../database/repositories/ContentOpportunityRepository';
import { PerformanceSignalRepository } from '../../database/repositories/PerformanceSignalRepository';
import {
  type CreateVideoIdeaData,
  VideoIdeaRepository,
} from '../../database/repositories/VideoIdeaRepository';
import { ChannelMemoryService } from './ChannelMemoryService';
import { IdeaEvaluationService } from './IdeaEvaluationService';
import { InternalHistoryResearchProvider } from './InternalHistoryResearchProvider';
import type { RawVideoPerformanceRecord } from '../../domains/performance-intelligence/PerformanceProvider';
import { ManualPerformanceProvider } from '../../domains/performance-intelligence/PerformanceProvider';
import { VideoPerformanceSnapshotRepository } from '../../database/repositories/VideoPerformanceSnapshotRepository';
import { PerformanceBaselineService } from '../performance-intelligence/PerformanceBaselineService';
import { PerformanceIngestionService } from '../performance-intelligence/PerformanceIngestionService';
import { ChannelContextResolver } from '../channel-context';

export interface RegisterVideoIdeaInput {
  projectId?: string;
  game?: string;
  theme: string;
  format: string;
  premise: string;
  estimatedEffort?: number;
  novelty?: number;
  identityFit?: number;
}

export interface RegisterContentOpportunityInput {
  videoIdeaId: string;
  source: string;
  classification: EvidenceClassification;
  summary: string;
  score?: number;
}

export interface EditorialRecommendation {
  recommendation: RankedIdeaEvaluation | null;
  ranking: RankedIdeaEvaluation[];
  classification: 'recommendation';
  disclaimer: string;
}

export interface PlannerEditorialIntelligenceProvider {
  recommendEditorial(projectId?: string | null): Promise<EditorialRecommendation>;
  buildContext(projectId?: string | null): Promise<CreatorIntelligenceContext>;
  getChannelLearnings?(projectId?: string | null): Promise<Array<{
    category: string;
    subject: string;
    statement: string;
    confidence: number;
    classification: string;
    evidence: unknown;
  }>>;
}

export interface CreatorIntelligenceServiceOptions {
  ideaRepository?: VideoIdeaRepository;
  opportunityRepository?: ContentOpportunityRepository;
  decisionRepository?: ContentDecisionRepository;
  insightRepository?: ChannelInsightRepository;
  performanceSignalRepository?: PerformanceSignalRepository;
  evaluationService?: IdeaEvaluationService;
  researchProviders?: readonly ResearchProvider[];
  channelMemoryService?: ChannelMemoryService;
  snapshotRepository?: VideoPerformanceSnapshotRepository;
  performanceIngestionService?: PerformanceIngestionService;
  performanceBaselineService?: PerformanceBaselineService;
  channelContextResolver?: Pick<ChannelContextResolver, 'resolve'>;
}

export class CreatorIntelligenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreatorIntelligenceError';
  }
}

export class CreatorIntelligenceValidationError extends CreatorIntelligenceError {
  constructor(message: string) {
    super(message);
    this.name = 'CreatorIntelligenceValidationError';
  }
}

export class VideoIdeaNotFoundError extends CreatorIntelligenceError {
  constructor() {
    super('Video idea not found');
    this.name = 'VideoIdeaNotFoundError';
  }
}

const normalizeOptionalText = (value: string | undefined): string | null =>
  value?.trim() || null;

const requireText = (value: string, field: string, maxLength: number): string => {
  const normalized = value.trim();
  if (!normalized) throw new CreatorIntelligenceValidationError(`${field} is required`);
  if (Array.from(normalized).length > maxLength) {
    throw new CreatorIntelligenceValidationError(`${field} is too long`);
  }
  return normalized;
};

const normalizeScore = (value: number | undefined, field: string): number | null => {
  if (value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new CreatorIntelligenceValidationError(`${field} must be between 0 and 100`);
  }
  return value;
};

const toDecisionEvidence = (evaluation: IdeaEvaluation): Prisma.InputJsonValue => ({
  classification: evaluation.classification,
  components: evaluation.components.map((component) => ({
    factor: component.factor,
    value: component.value,
    weight: component.weight,
    classification: component.classification,
    rationale: component.rationale,
    sources: component.sources,
  })),
  unknownFactors: evaluation.unknownFactors,
  confidence: evaluation.confidence,
  evidenceUsed: evaluation.evidenceUsed,
  risks: evaluation.risks,
  missingData: evaluation.missingData,
});

const toEvaluationFromDecision = (decision: ContentDecision): IdeaEvaluation => ({
  ideaId: decision.videoIdeaId,
  score: decision.score,
  category: decision.category as ContentDecisionCategory,
  classification: 'recommendation',
  rationale: decision.rationale,
  components: [],
  unknownFactors: [],
  confidence: 0,
  evidenceUsed: [],
  risks: [],
  missingData: [],
});

export class CreatorIntelligenceService implements PlannerEditorialIntelligenceProvider {
  private ideaRepository?: VideoIdeaRepository;
  private opportunityRepository?: ContentOpportunityRepository;
  private decisionRepository?: ContentDecisionRepository;
  private insightRepository?: ChannelInsightRepository;
  private performanceSignalRepository?: PerformanceSignalRepository;
  private readonly evaluationService: IdeaEvaluationService;
  private researchProviders?: readonly ResearchProvider[];
  private channelMemoryService?: ChannelMemoryService;
  private snapshotRepository?: VideoPerformanceSnapshotRepository;
  private performanceIngestionService?: PerformanceIngestionService;
  private performanceBaselineService?: PerformanceBaselineService;
  private readonly channelContextResolver: Pick<ChannelContextResolver, 'resolve'>;

  constructor(options: CreatorIntelligenceServiceOptions = {}) {
    this.ideaRepository = options.ideaRepository;
    this.opportunityRepository = options.opportunityRepository;
    this.decisionRepository = options.decisionRepository;
    this.insightRepository = options.insightRepository;
    this.performanceSignalRepository = options.performanceSignalRepository;
    this.evaluationService = options.evaluationService ?? new IdeaEvaluationService();
    this.researchProviders = options.researchProviders;
    this.channelMemoryService = options.channelMemoryService;
    this.snapshotRepository = options.snapshotRepository;
    this.performanceIngestionService = options.performanceIngestionService;
    this.performanceBaselineService = options.performanceBaselineService;
    this.channelContextResolver = options.channelContextResolver ?? new ChannelContextResolver();
  }

  private get ideas(): VideoIdeaRepository {
    if (!this.ideaRepository) {
      this.ideaRepository = new VideoIdeaRepository(DatabaseService.client);
    }
    return this.ideaRepository;
  }

  private get opportunities(): ContentOpportunityRepository {
    if (!this.opportunityRepository) {
      this.opportunityRepository = new ContentOpportunityRepository(DatabaseService.client);
    }
    return this.opportunityRepository;
  }

  private get decisions(): ContentDecisionRepository {
    if (!this.decisionRepository) {
      this.decisionRepository = new ContentDecisionRepository(DatabaseService.client);
    }
    return this.decisionRepository;
  }

  private get insights(): ChannelInsightRepository {
    if (!this.insightRepository) {
      this.insightRepository = new ChannelInsightRepository(DatabaseService.client);
    }
    return this.insightRepository;
  }

  private get performanceSignals(): PerformanceSignalRepository {
    if (!this.performanceSignalRepository) {
      this.performanceSignalRepository = new PerformanceSignalRepository(DatabaseService.client);
    }
    return this.performanceSignalRepository;
  }

  private get providers(): readonly ResearchProvider[] {
    if (!this.researchProviders) {
      this.researchProviders = [new InternalHistoryResearchProvider(this.performanceSignals)];
    }
    return this.researchProviders;
  }

  private get memory(): ChannelMemoryService {
    if (!this.channelMemoryService) {
      this.channelMemoryService = new ChannelMemoryService(
        this.insights,
        this.performanceSignals,
        this.performanceSnapshots,
      );
    }
    return this.channelMemoryService;
  }

  private get performanceSnapshots(): VideoPerformanceSnapshotRepository {
    if (!this.snapshotRepository) {
      this.snapshotRepository = new VideoPerformanceSnapshotRepository(DatabaseService.client);
    }
    return this.snapshotRepository;
  }

  private get ingestion(): PerformanceIngestionService {
    if (!this.performanceIngestionService) {
      this.performanceIngestionService = new PerformanceIngestionService(
        this.performanceSnapshots,
        this.performanceSignals,
      );
    }
    return this.performanceIngestionService;
  }

  private get baseline(): PerformanceBaselineService {
    if (!this.performanceBaselineService) {
      this.performanceBaselineService = new PerformanceBaselineService(this.performanceSnapshots);
    }
    return this.performanceBaselineService;
  }

  async registerIdea(input: RegisterVideoIdeaInput): Promise<VideoIdea> {
    const estimatedEffort = input.estimatedEffort ?? null;
    if (
      estimatedEffort !== null
      && (!Number.isInteger(estimatedEffort) || estimatedEffort < 1 || estimatedEffort > 5)
    ) {
      throw new CreatorIntelligenceValidationError('estimatedEffort must be an integer from 1 to 5');
    }

    const data: CreateVideoIdeaData = {
      projectId: normalizeOptionalText(input.projectId),
      game: normalizeOptionalText(input.game),
      theme: requireText(input.theme, 'theme', 160),
      format: requireText(input.format, 'format', 120),
      premise: requireText(input.premise, 'premise', 1_000),
      estimatedEffort,
      novelty: normalizeScore(input.novelty, 'novelty'),
      identityFit: normalizeScore(input.identityFit, 'identityFit'),
    };
    return this.ideas.create(data);
  }

  async listIdeas(projectId?: string | null): Promise<VideoIdea[]> {
    return this.ideas.findAll(projectId === undefined ? undefined : projectId?.trim() || null);
  }

  async registerOpportunity(
    input: RegisterContentOpportunityInput,
  ): Promise<ContentOpportunity> {
    const idea = await this.ideas.findById(input.videoIdeaId.trim());
    if (!idea) throw new VideoIdeaNotFoundError();

    return this.opportunities.create({
      videoIdeaId: idea.id,
      source: requireText(input.source, 'source', 120),
      classification: input.classification,
      summary: requireText(input.summary, 'summary', 1_000),
      score: normalizeScore(input.score, 'score'),
    });
  }

  private async collectResearch(idea: VideoIdea): Promise<ResearchEvidence[]> {
    const results = await Promise.all(this.providers.map((provider) => provider.research(idea)));
    return results.flat().slice(0, 50);
  }

  private async evaluateWithoutPersistence(idea: VideoIdea): Promise<IdeaEvaluation> {
    return this.evaluationService.evaluate(idea, await this.collectResearch(idea));
  }

  async evaluateIdea(id: string): Promise<{ idea: VideoIdea; decision: ContentDecision; evaluation: IdeaEvaluation }> {
    const idea = await this.ideas.findById(id.trim());
    if (!idea) throw new VideoIdeaNotFoundError();

    const evaluation = await this.evaluateWithoutPersistence(idea);
    const decision = await this.decisions.create({
      videoIdeaId: idea.id,
      category: evaluation.category,
      score: evaluation.score,
      rationale: evaluation.rationale,
      evidence: toDecisionEvidence(evaluation),
    });
    return { idea, decision, evaluation };
  }

  async compareIdeas(ids: readonly string[]): Promise<RankedIdeaEvaluation[]> {
    const normalizedIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (normalizedIds.length < 2 || normalizedIds.length > 20) {
      throw new CreatorIntelligenceValidationError('ideaIds must contain between 2 and 20 unique ids');
    }

    const evaluations = await Promise.all(normalizedIds.map(async (id) => {
      const result = await this.evaluateIdea(id);
      return result.evaluation;
    }));
    return this.evaluationService.rank(evaluations);
  }

  async rankIdeas(ids: readonly string[]): Promise<RankedIdeaEvaluation[]> {
    const normalizedIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (normalizedIds.length < 1 || normalizedIds.length > 20) {
      throw new CreatorIntelligenceValidationError('ideaIds must contain between 1 and 20 unique ids');
    }
    const evaluations = await Promise.all(normalizedIds.map(async (id) => {
      const idea = await this.ideas.findById(id);
      if (!idea) throw new VideoIdeaNotFoundError();
      return this.evaluateWithoutPersistence(idea);
    }));
    return this.evaluationService.rank(evaluations);
  }

  async recommendEditorial(projectId?: string | null): Promise<EditorialRecommendation> {
    const ideas = await this.listIdeas(projectId === undefined ? undefined : projectId);
    if (ideas.length === 0) {
      return {
        recommendation: null,
        ranking: [],
        classification: 'recommendation',
        disclaimer: 'Ainda não há ideias cadastradas para recomendar. Nenhuma previsão de views foi produzida.',
      };
    }

    const evaluations = await Promise.all(
      ideas.slice(0, 20).map((idea) => this.evaluateWithoutPersistence(idea)),
    );
    const ranking = this.evaluationService.rank(evaluations);
    return {
      recommendation: ranking[0] ?? null,
      ranking,
      classification: 'recommendation',
      disclaimer: 'Ranking relativo baseado somente nas evidências disponíveis; não é previsão de views.',
    };
  }

  async buildContext(projectId?: string | null): Promise<CreatorIntelligenceContext> {
    const normalizedProjectId = projectId?.trim() || null;
    const [ideas, insights, opportunities, decisions, temporal] = await Promise.all([
      this.ideas.findAll(normalizedProjectId),
      this.memory.listMemory(normalizedProjectId),
      this.opportunities.findAll(),
      this.decisions.findAll(),
      this.channelContextResolver.resolve({ projectId: normalizedProjectId, text: 'analytics estrategia formatos performance plataforma', limit: 10, maxCharacters: 5_000 }).catch(() => ({ entries: [] })),
    ]);
    const selectedIdeas = ideas.slice(0, 5);
    const selectedIds = new Set(selectedIdeas.map(({ id }) => id));
    const relevantHistory = (await Promise.all(
      selectedIdeas.slice(0, 3).map((idea) => this.collectResearch(idea)),
    )).flat().slice(0, 12);

    return {
      channelState: {
        insights: insights.slice(0, 10).map((insight) => ({
          category: insight.category,
          subject: insight.subject,
          statement: insight.statement,
          confidence: insight.confidence,
          classification: insight.classification as EvidenceClassification,
        })),
      },
      relevantHistory,
      ideas: selectedIdeas.map(({ id, game, theme, format, premise }) => ({
        id,
        game,
        theme,
        format,
        premise,
      })),
      opportunities: opportunities
        .filter(({ videoIdeaId }) => selectedIds.has(videoIdeaId))
        .slice(0, 10)
        .map(({ videoIdeaId, summary, classification }) => ({
          ideaId: videoIdeaId,
          summary,
          classification: classification as EvidenceClassification,
        })),
      previousDecisions: decisions
        .filter(({ videoIdeaId }) => selectedIds.has(videoIdeaId))
        .slice(0, 10)
        .map((decision) => {
          const evaluation = toEvaluationFromDecision(decision);
          return {
            id: decision.id,
            ideaId: evaluation.ideaId,
            category: evaluation.category,
            score: evaluation.score,
            rationale: evaluation.rationale,
          };
        }),
      creatorConstraints: insights
        .filter(({ category }) => category === 'creator_preference')
        .slice(0, 5)
        .map(({ statement }) => statement),
      temporalContext: temporal.entries.map(({ id, type, status, category, subject, statement, confidence, occurredAt, periodStart, periodEnd }) => ({
        id, type, status, category, subject, statement, confidence, occurredAt, periodStart, periodEnd,
      })),
    };
  }

  async getChannelLearnings(projectId?: string | null) {
    const normalizedProjectId = projectId?.trim() || null;
    await this.memory.refreshFromSnapshots(normalizedProjectId);
    return this.memory.listMemory(normalizedProjectId);
  }

  async getDecisionEvidence(id: string): Promise<ContentDecision | null> {
    return this.decisions.findById(id.trim());
  }

  async ingestManualPerformance(
    records: readonly RawVideoPerformanceRecord[],
    projectId?: string | null,
  ) {
    const result = await this.ingestion.ingest(new ManualPerformanceProvider(records), projectId);
    const projects = [...new Set(result.records.map(({ projectId: id }) => id))];
    await Promise.all(projects.map((id) => this.memory.refreshFromSnapshots(id)));
    return result;
  }

  async listPerformanceRecords(projectId?: string | null) {
    return this.performanceSnapshots.findAll(
      projectId === undefined ? {} : { projectId: projectId?.trim() || null },
    );
  }

  async listPerformanceSignals(projectId?: string | null) {
    return this.performanceSignals.findAll(
      projectId === undefined ? {} : { projectId: projectId?.trim() || null },
    );
  }

  async getPerformanceBaseline(projectId?: string | null) {
    return this.baseline.getBaseline(projectId);
  }
}
