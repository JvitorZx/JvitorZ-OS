import { createHash } from 'crypto';
import type { Prisma, ResearchHistory, ResearchOpportunity as PersistedResearchOpportunity } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import {
  ResearchHistoryRepository,
  type ResearchHistoryWithOpportunities,
} from '../../database/repositories/ResearchHistoryRepository';
import {
  ResearchOpportunityRepository,
  type ResearchOpportunityWithHistory,
} from '../../database/repositories/ResearchOpportunityRepository';
import type {
  ResearchExecution,
  ResearchFreshness,
  ResearchOpportunity,
  ResearchProvider,
  ResearchProviderResult,
  ResearchQuality,
  ResearchRequest,
  ResearchSource,
} from '../../domains/research';
import { InternalResearchProvider } from './InternalResearchProvider';
import { OpportunityDiscoveryService } from './OpportunityDiscoveryService';
import { normalizeResearchRequest, ResearchValidationError } from './ResearchNormalization';

export { ResearchValidationError } from './ResearchNormalization';

export class ResearchNotFoundError extends Error {
  constructor(message = 'Research record not found') {
    super(message);
    this.name = 'ResearchNotFoundError';
  }
}

export class ResearchProviderUnavailableError extends Error {
  constructor() {
    super('Research providers are unavailable');
    this.name = 'ResearchProviderUnavailableError';
  }
}

export interface ResearchServiceOptions {
  historyRepository?: ResearchHistoryRepository;
  opportunityRepository?: ResearchOpportunityRepository;
  providers?: readonly ResearchProvider[];
  discovery?: OpportunityDiscoveryService;
  clock?: () => Date;
  cacheTtlMs?: number;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const isUniqueConstraintError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const qualityFor = (results: readonly ResearchProviderResult[], failures: number): ResearchQuality => {
  if (results.length === 0) return 'ERROR';
  if (failures > 0) return 'PARTIAL';
  if (results.every(({ evidence }) => evidence.length === 0)) return 'MISSING';
  if (results.some(({ source }) => source.quality === 'INCONSISTENT')) return 'INCONSISTENT';
  if (results.every(({ source }) => source.quality === 'STALE')) return 'STALE';
  if (results.some(({ source }) => ['PARTIAL', 'STALE', 'MISSING'].includes(source.quality))) return 'PARTIAL';
  return 'GOOD';
};
const freshnessForResults = (results: readonly ResearchProviderResult[]): ResearchFreshness => {
  const order: ResearchFreshness[] = ['MISSING', 'STALE', 'AGING', 'RECENT'];
  return results.map(({ source }) => source.freshness)
    .sort((left, right) => order.indexOf(left) - order.indexOf(right))[0] ?? 'MISSING';
};

const parse = <T>(value: Prisma.JsonValue): T => value as T;
const opportunityFromRow = (row: PersistedResearchOpportunity): ResearchOpportunity => ({
  key: row.key,
  rank: row.rank,
  subject: row.subject,
  subjectType: row.subjectType as ResearchOpportunity['subjectType'],
  state: row.state as ResearchOpportunity['state'],
  summary: row.summary,
  sources: parse<string[]>(row.sources),
  evidence: parse<ResearchOpportunity['evidence']>(row.evidence),
  freshness: row.freshness as ResearchFreshness,
  compatibility: row.compatibility,
  confidence: row.confidence,
  risks: parse<string[]>(row.risks),
  gaps: parse<string[]>(row.gaps),
  nextInvestigation: row.nextInvestigation,
});

const executionFromRow = (
  row: ResearchHistoryWithOpportunities,
  cache: ResearchExecution['cache'],
  freshnessOverride?: ResearchFreshness,
): ResearchExecution => ({
  historyId: row.id,
  query: {
    text: row.query,
    normalized: row.normalizedQuery,
    intent: row.intent as ResearchExecution['query']['intent'],
    projectId: row.projectId,
    subjectType: row.subjectType as ResearchExecution['query']['subjectType'],
    subject: row.subject,
  },
  sources: parse<ResearchSource[]>(row.sources),
  results: parse<ResearchExecution['results']>(row.results),
  opportunities: row.opportunities.map(opportunityFromRow),
  quality: row.quality as ResearchQuality,
  freshness: freshnessOverride ?? row.freshness as ResearchFreshness,
  limitations: parse<string[]>(row.limitations),
  researchedAt: row.researchedAt.toISOString(),
  validUntil: row.validUntil.toISOString(),
  cache,
});

export class ResearchService {
  private historyRepository?: ResearchHistoryRepository;
  private opportunityRepository?: ResearchOpportunityRepository;
  private readonly providers: readonly ResearchProvider[];
  private readonly discovery: OpportunityDiscoveryService;
  private readonly clock: () => Date;
  private readonly cacheTtlMs: number;

  constructor(options: ResearchServiceOptions = {}) {
    this.historyRepository = options.historyRepository;
    this.opportunityRepository = options.opportunityRepository;
    this.providers = options.providers ?? [new InternalResearchProvider()];
    this.discovery = options.discovery ?? new OpportunityDiscoveryService();
    this.clock = options.clock ?? (() => new Date());
    this.cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
  }

  private get history(): ResearchHistoryRepository {
    if (!this.historyRepository) this.historyRepository = new ResearchHistoryRepository(DatabaseService.client);
    return this.historyRepository;
  }

  private get opportunities(): ResearchOpportunityRepository {
    if (!this.opportunityRepository) this.opportunityRepository = new ResearchOpportunityRepository(DatabaseService.client);
    return this.opportunityRepository;
  }

  async research(input: ResearchRequest): Promise<ResearchExecution> {
    const query = normalizeResearchRequest(input);
    const now = this.clock();
    const cacheKey = hash({
      query: query.normalized, intent: query.intent, projectId: query.projectId,
      subjectType: query.subjectType, subject: query.subject?.toLowerCase() ?? null,
    });
    if (!input.forceRefresh) {
      const cached = await this.history.findFresh(cacheKey, now);
      if (cached) return executionFromRow(cached, 'HIT');
    }

    const available = this.providers.filter((provider) => provider.supports(query.intent));
    const settled = await Promise.allSettled(available.map((provider) => provider.search(query)));
    const results = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    const failedProviders = settled.flatMap((result, index) => result.status === 'rejected' ? [available[index].id] : []);
    if (results.length === 0) {
      const previous = await this.history.findLatest(cacheKey);
      if (previous) return {
        ...executionFromRow(previous, 'STALE_FALLBACK', 'STALE'),
        limitations: [...parse<string[]>(previous.limitations), 'Providers indisponíveis; exibindo último resultado válido como desatualizado.'],
      };
      throw new ResearchProviderUnavailableError();
    }

    const discovered = this.discovery.discover(query, results);
    const quality = qualityFor(results, failedProviders.length);
    const freshness = freshnessForResults(results);
    const limitations = [
      ...new Set([
        ...results.flatMap(({ source }) => source.limitations),
        ...failedProviders.map((id) => `Provider ${id} indisponível nesta execução.`),
        ...(results.every(({ source }) => source.kind === 'INTERNAL')
          ? ['A pesquisa atual usa somente dados internos; não representa o mercado externo.'] : []),
      ]),
    ];
    const validUntil = new Date(now.getTime() + this.cacheTtlMs);
    const bucket = input.forceRefresh ? now.getTime() : Math.floor(now.getTime() / this.cacheTtlMs);
    const executionKey = hash({ cacheKey, bucket });
    try {
      const row = await this.history.create({
        projectId: query.projectId, executionKey, cacheKey, query: query.text,
        normalizedQuery: query.normalized, intent: query.intent, subjectType: query.subjectType,
        subject: query.subject, sources: asJson(results.map(({ source }) => source)), results: asJson(results),
        quality, freshness, limitations: asJson(limitations), context: asJson({ providerCount: available.length }),
        researchedAt: now, validUntil,
        opportunities: discovered.map((opportunity) => ({
          key: opportunity.key, rank: opportunity.rank, subject: opportunity.subject, subjectType: opportunity.subjectType,
          state: opportunity.state, summary: opportunity.summary, sources: asJson(opportunity.sources),
          evidence: asJson(opportunity.evidence), freshness: opportunity.freshness,
          compatibility: opportunity.compatibility, confidence: opportunity.confidence,
          risks: asJson(opportunity.risks), gaps: asJson(opportunity.gaps),
          nextInvestigation: opportunity.nextInvestigation,
        })),
      });
      return executionFromRow(row, 'MISS');
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existing = await this.history.findByExecutionKey(executionKey);
      if (!existing) throw error;
      return executionFromRow(existing, 'HIT');
    }
  }

  async researchGames(input: Omit<ResearchRequest, 'intent' | 'subjectType'>): Promise<ResearchExecution> {
    return this.research({ ...input, intent: 'GAME_DISCOVERY', subjectType: 'GAME' });
  }

  async researchTopics(input: Omit<ResearchRequest, 'intent' | 'subjectType'>): Promise<ResearchExecution> {
    return this.research({ ...input, intent: 'TOPIC_RESEARCH', subjectType: 'TOPIC' });
  }

  async listHistory(filters: { projectId?: string | null; limit?: number } = {}): Promise<ResearchExecution[]> {
    const limit = filters.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ResearchValidationError('limit must be an integer from 1 to 50');
    return (await this.history.findAll({ ...filters, limit })).map((row) => executionFromRow(row, 'HIT'));
  }

  async getHistory(id: string): Promise<ResearchExecution> {
    const normalized = id.trim();
    if (!normalized) throw new ResearchValidationError('research id is required');
    const row = await this.history.findById(normalized);
    if (!row) throw new ResearchNotFoundError();
    return executionFromRow(row, 'HIT');
  }

  async refresh(id: string): Promise<ResearchExecution> {
    const previous = await this.getHistory(id);
    return this.research({
      query: previous.query.text, intent: previous.query.intent, projectId: previous.query.projectId,
      subjectType: previous.query.subjectType ?? undefined, subject: previous.query.subject ?? undefined,
      forceRefresh: true,
    });
  }

  async listOpportunities(filters: { projectId?: string | null; state?: string; limit?: number } = {}): Promise<ResearchOpportunityWithHistory[]> {
    const limit = filters.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ResearchValidationError('limit must be an integer from 1 to 100');
    return this.opportunities.findAll({ ...filters, limit });
  }

  async getOpportunity(id: string): Promise<ResearchOpportunityWithHistory> {
    const normalized = id.trim();
    if (!normalized) throw new ResearchValidationError('opportunity id is required');
    const row = await this.opportunities.findById(normalized);
    if (!row) throw new ResearchNotFoundError('Research opportunity not found');
    return row;
  }

  async getOperationalSummary(projectId?: string | null) {
    const [history, opportunities] = await Promise.all([
      this.history.findAll({ ...(projectId === undefined ? {} : { projectId }), limit: 10 }),
      this.opportunities.findAll({ ...(projectId === undefined ? {} : { projectId }), limit: 50 }),
    ]);
    const latest = history[0];
    return {
      totalResearches: history.length,
      opportunities: opportunities.length,
      lowConfidence: opportunities.filter(({ confidence }) => confidence < 0.5).length,
      stale: history.filter(({ freshness }) => freshness === 'STALE').length,
      conflicts: opportunities.filter(({ risks }) => parse<string[]>(risks).some((risk) => /conflit/i.test(risk))).length,
      quality: latest?.quality ?? 'MISSING',
      freshness: latest?.freshness ?? 'MISSING',
      latestAt: latest?.researchedAt ?? null,
      sources: latest ? parse<ResearchSource[]>(latest.sources).map(({ id, kind, freshness, quality }) => ({ id, kind, freshness, quality })) : [],
    };
  }
}
