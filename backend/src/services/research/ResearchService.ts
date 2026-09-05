import { createHash, randomUUID } from 'crypto';
import type { Prisma, ResearchHistory, ResearchOpportunity as PersistedResearchOpportunity } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import {
  ResearchHistoryRepository,
  type ResearchSessionDetails,
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
import { RESEARCH_SESSION_STATUSES, scoreOpportunity, type ProductionEffort } from '../../domains/research';
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

export class ResearchConflictError extends Error {
  constructor(message = 'Research session conflicts with its current state') {
    super(message);
    this.name = 'ResearchConflictError';
  }
}

export interface CreateResearchSessionInput extends ResearchRequest {
  objective?: string;
  format?: string;
  game?: string;
  constraints?: string[];
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
  private readonly sessionLocks = new Map<string, Promise<unknown>>();

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

  private presentSession(session: ResearchSessionDetails): ResearchSessionDetails {
    if (session.status !== 'COMPLETED' || session.freshness === 'MISSING' || session.freshness === 'STALE'
      || session.validUntil.getTime() > this.clock().getTime()) return session;
    const limitation = 'A sessão expirou; reexecute a pesquisa antes de tratá-la como atual.';
    const limitations = [...new Set([...parse<string[]>(session.limitations), limitation])];
    return {
      ...session,
      freshness: 'STALE',
      limitations: limitations as Prisma.JsonValue,
      opportunities: session.opportunities.map((opportunity) => ({
        ...opportunity,
        freshness: 'STALE',
        qualityGate: opportunity.qualityGate === 'INSUFFICIENT_EVIDENCE' ? opportunity.qualityGate : 'STALE',
      })),
    };
  }

  private async locked<T>(key: string, work: () => Promise<T>): Promise<T> {
    const prior = this.sessionLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = prior.then(() => current);
    this.sessionLocks.set(key, queued);
    await prior;
    try { return await work(); } finally {
      release();
      if (this.sessionLocks.get(key) === queued) this.sessionLocks.delete(key);
    }
  }

  async createSession(input: CreateResearchSessionInput): Promise<ResearchSessionDetails> {
    const query = normalizeResearchRequest(input);
    const objective = input.objective?.trim() || query.text;
    if (objective.length > 500) throw new ResearchValidationError('objective must contain at most 500 characters');
    const format = input.format?.trim().toUpperCase() || null;
    if (format && format.length > 80) throw new ResearchValidationError('format must contain at most 80 characters');
    const game = input.game?.trim() || null;
    if (game && game.length > 160) throw new ResearchValidationError('game must contain at most 160 characters');
    const constraints = input.constraints ?? [];
    if (!Array.isArray(constraints) || constraints.length > 20 || constraints.some((item) => typeof item !== 'string' || !item.trim() || item.length > 300)) {
      throw new ResearchValidationError('constraints must contain at most 20 short strings');
    }
    const now = this.clock();
    const sessionKey = `session:${randomUUID()}`;
    return this.history.createSession({
      projectId: query.projectId, executionKey: sessionKey, cacheKey: sessionKey,
      query: query.text, normalizedQuery: query.normalized, intent: query.intent,
      subjectType: query.subjectType, subject: query.subject, sources: asJson([]), results: asJson([]),
      quality: 'MISSING', freshness: 'MISSING', limitations: asJson(['Sessão ainda não executada.']),
      context: asJson({ source: 'research-session' }), researchedAt: now, validUntil: now,
      status: 'DRAFT', objective, format, game, constraints: asJson(constraints.map((item) => item.trim())),
      runVersion: 1, startedAt: null, completedAt: null, eventAt: now,
    });
  }

  async runSession(id: string): Promise<ResearchSessionDetails> {
    const sessionId = id.trim();
    if (!sessionId) throw new ResearchValidationError('research session id is required');
    return this.locked(sessionId, async () => {
      const session = await this.history.findSessionById(sessionId);
      if (!session) throw new ResearchNotFoundError('Research session not found');
      if (session.status === 'COMPLETED') return this.presentSession(session);
      if (session.status !== 'DRAFT') throw new ResearchConflictError();
      const now = this.clock();
      if (!await this.history.claimRun(sessionId, now)) throw new ResearchConflictError();
      const query = normalizeResearchRequest({
        query: session.query, intent: session.intent as ResearchRequest['intent'], projectId: session.projectId,
        subjectType: session.subjectType ? session.subjectType as ResearchRequest['subjectType'] : undefined,
        subject: session.subject ?? undefined,
      });
      try {
        const available = this.providers.filter((provider) => provider.supports(query.intent));
        const settled = await Promise.allSettled(available.map((provider) => provider.search(query)));
        const results = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
        const failedProviders = settled.flatMap((result, index) => result.status === 'rejected' ? [available[index].id] : []);
        if (!results.length) throw new ResearchProviderUnavailableError();
        const discovered = this.discovery.discover(query, results);
        const quality = qualityFor(results, failedProviders.length);
        const freshness = freshnessForResults(results);
        const limitations = [...new Set([
          ...results.flatMap(({ source }) => source.limitations),
          ...failedProviders.map((providerId) => `Provider ${providerId} indisponível nesta execução.`),
          ...(results.every(({ source }) => source.kind === 'INTERNAL') ? ['A pesquisa usa somente dados internos e não representa demanda externa.'] : []),
        ])];
        const constraints = parse<string[]>(session.constraints);
        const effort = constraints.find((item) => /esfor[cç]o\s*:\s*(low|medium|high)/i.test(item))?.match(/(low|medium|high)/i)?.[1]?.toUpperCase() as ProductionEffort | undefined;
        const opportunities = discovered.map((opportunity) => {
          const score = scoreOpportunity(opportunity, { effort, objective: session.objective });
          return {
            key: opportunity.key, rank: opportunity.rank, subject: opportunity.subject, subjectType: opportunity.subjectType,
            state: opportunity.state, summary: opportunity.summary, sources: asJson(opportunity.sources), evidence: asJson(opportunity.evidence),
            freshness: opportunity.freshness, compatibility: opportunity.compatibility, confidence: opportunity.confidence,
            risks: asJson(score.risks), gaps: asJson(score.missingData), nextInvestigation: opportunity.nextInvestigation,
            candidateStatus: 'CANDIDATE', effort: effort ?? 'UNKNOWN',
            novelty: score.dimensions.find(({ key }) => key === 'NOVELTY')?.value ?? null,
            saturation: score.dimensions.find(({ key }) => key === 'SATURATION_RISK')?.value ?? null,
            qualityGate: score.qualityGate, scoreDetails: asJson(score),
          };
        });
        const evidence = results.flatMap(({ source, evidence: items }) => items.map((item) => ({
          evidenceKey: `${source.id}:${item.id}`, sourceType: source.kind === 'INTERNAL' ? 'INTERNAL_ANALYSIS' : 'EXTERNAL_SOURCE',
          sourceId: item.sourceId, sourceName: source.label, classification: item.classification,
          description: item.summary, metricName: typeof item.context.metric === 'string' ? item.context.metric : null,
          metricValue: typeof item.context.value === 'number' ? item.context.value : null,
          unit: typeof item.context.unit === 'string' ? item.context.unit : null,
          reference: null, observedAt: item.observedAt ? new Date(item.observedAt) : null, retrievedAt: now,
          freshness: item.freshness, confidence: item.confidence, provenance: asJson({ provider: source.provider }), context: asJson(item.context),
        })));
        const gaps = discovered.flatMap((opportunity) => opportunity.gaps.slice(0, 5).map((description, index) => ({
          gapKey: `${opportunity.key}:${index + 1}`, description, relevance: Math.max(0, 1 - opportunity.rank / 20),
          risk: opportunity.risks[0] ?? null, freshness: opportunity.freshness,
          game: opportunity.subjectType === 'GAME' ? opportunity.subject : session.game,
          series: opportunity.subjectType === 'SERIES' ? opportunity.subject : null,
          possibleAction: opportunity.nextInvestigation, evidence: asJson(opportunity.evidence),
        })));
        return this.history.completeSession({
          id: sessionId, sources: asJson(results.map(({ source }) => source)), results: asJson(results), quality, freshness,
          limitations: asJson(limitations), context: asJson({ providerCount: available.length, failedProviders, constraints }),
          researchedAt: now, validUntil: new Date(now.getTime() + this.cacheTtlMs), opportunities, evidence, gaps,
        });
      } catch (error) {
        await this.history.failSession(sessionId, this.clock(), error instanceof Error ? error.name : 'UnknownError');
        throw error;
      }
    });
  }

  async rerunSession(id: string): Promise<ResearchSessionDetails> {
    const previous = await this.getSession(id);
    if (!['COMPLETED', 'FAILED'].includes(previous.status)) throw new ResearchConflictError('Only completed or failed sessions can be rerun');
    const created = await this.createSession({
      query: previous.query, intent: previous.intent as ResearchRequest['intent'], projectId: previous.projectId,
      subjectType: previous.subjectType ? previous.subjectType as ResearchRequest['subjectType'] : undefined,
      subject: previous.subject ?? undefined,
      objective: previous.objective ?? undefined, format: previous.format ?? undefined, game: previous.game ?? undefined,
      constraints: parse<string[]>(previous.constraints),
    });
    await this.history.addEvent(previous.id, 'SESSION_RERUN_REQUESTED', this.clock(), asJson({ nextSessionId: created.id }));
    return this.runSession(created.id);
  }

  async archiveSession(id: string): Promise<ResearchSessionDetails> {
    const session = await this.getSession(id);
    if (session.status === 'RUNNING') throw new ResearchConflictError('Running session cannot be archived');
    if (session.status === 'ARCHIVED') return session;
    return this.history.archiveSession(session.id, this.clock());
  }

  async getSession(id: string): Promise<ResearchSessionDetails> {
    const normalized = id.trim();
    if (!normalized) throw new ResearchValidationError('research session id is required');
    const session = await this.history.findSessionById(normalized);
    if (!session) throw new ResearchNotFoundError('Research session not found');
    return this.presentSession(session);
  }

  async listSessions(filters: { projectId?: string | null; status?: string; limit?: number } = {}): Promise<ResearchSessionDetails[]> {
    const limit = filters.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ResearchValidationError('limit must be an integer from 1 to 50');
    if (filters.status && !RESEARCH_SESSION_STATUSES.includes(filters.status as never)) throw new ResearchValidationError('research session status is invalid');
    return (await this.history.findSessions({ ...filters, limit })).map((session) => this.presentSession(session));
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
