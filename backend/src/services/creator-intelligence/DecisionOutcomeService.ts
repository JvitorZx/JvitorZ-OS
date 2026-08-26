import type {
  EditorialDecision,
  EditorialDecisionOutcome,
  EditorialDecisionVideoLink,
  Prisma,
  PrismaClient,
  VideoPerformanceSnapshot,
} from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { ChannelInsightRepository } from '../../database/repositories/ChannelInsightRepository';
import { EditorialDecisionRepository } from '../../database/repositories/EditorialDecisionRepository';
import {
  EditorialDecisionOutcomeRepository,
  type EditorialDecisionOutcomeWithDetails,
} from '../../database/repositories/EditorialDecisionOutcomeRepository';
import {
  EditorialDecisionVideoLinkRepository,
  type EditorialDecisionVideoLinkWithDetails,
} from '../../database/repositories/EditorialDecisionVideoLinkRepository';
import { PerformanceSignalRepository } from '../../database/repositories/PerformanceSignalRepository';
import { VideoPerformanceSnapshotRepository } from '../../database/repositories/VideoPerformanceSnapshotRepository';
import { ChannelMemoryService } from './ChannelMemoryService';

export const DECISION_OUTCOME_CLASSIFICATIONS = [
  'POSITIVE',
  'MIXED',
  'NEGATIVE',
  'INCONCLUSIVE',
] as const;

export type DecisionOutcomeClassification = (typeof DECISION_OUTCOME_CLASSIFICATIONS)[number];
export type DecisionVideoLinkStatus = 'awaiting_data' | 'evaluable' | 'evaluated';

export class DecisionOutcomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionOutcomeError';
  }
}

export class DecisionOutcomeValidationError extends DecisionOutcomeError {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionOutcomeValidationError';
  }
}

export class DecisionOutcomeDecisionNotFoundError extends DecisionOutcomeError {
  constructor() {
    super('Editorial decision not found');
    this.name = 'DecisionOutcomeDecisionNotFoundError';
  }
}

export class DecisionOutcomeSnapshotNotFoundError extends DecisionOutcomeError {
  constructor() {
    super('Performance snapshot not found');
    this.name = 'DecisionOutcomeSnapshotNotFoundError';
  }
}

export class DecisionOutcomeLinkNotFoundError extends DecisionOutcomeError {
  constructor() {
    super('Decision video link not found');
    this.name = 'DecisionOutcomeLinkNotFoundError';
  }
}

export class DecisionOutcomeLinkConflictError extends DecisionOutcomeError {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionOutcomeLinkConflictError';
  }
}

const isUniqueConstraintError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';

const normalizeId = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new DecisionOutcomeValidationError(`${field} is required`);
  return normalized;
};

const optionalText = (value: string | null | undefined, field: string, max: number): string | null => {
  if (value === undefined || value === null || value === '') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (Array.from(normalized).length > max) {
    throw new DecisionOutcomeValidationError(`${field} is too long`);
  }
  return normalized;
};

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const METRICS = [
  ['views', 'views', 'higher'],
  ['engagedViews', 'engaged views', 'higher'],
  ['impressions', 'impressions', 'higher'],
  ['ctr', 'CTR', 'higher'],
  ['watchTimeMinutes', 'watch time', 'higher'],
  ['averageViewDurationSeconds', 'average view duration', 'higher'],
  ['averageViewPercentage', 'average percentage viewed', 'higher'],
  ['subscribersGained', 'subscribers gained', 'higher'],
  ['subscribersLost', 'subscribers lost', 'lower'],
  ['likes', 'likes', 'higher'],
  ['comments', 'comments', 'higher'],
] as const;

type MetricName = (typeof METRICS)[number][0];

interface MetricBaseline {
  median: number | null;
  sampleSize: number;
}

interface MetricComparison {
  metric: MetricName;
  label: string;
  value: number;
  baselineMedian: number;
  baselineScope: 'format' | 'game' | 'channel';
  sampleSize: number;
  ratio: number | null;
  signal: 'supports' | 'contradicts' | 'neutral';
}

const baselineFor = (
  snapshots: readonly VideoPerformanceSnapshot[],
  metric: MetricName,
): MetricBaseline => {
  const values = snapshots.flatMap((snapshot) => {
    const value = snapshot[metric];
    return typeof value === 'number' && Number.isFinite(value) ? [value] : [];
  });
  return { median: median(values), sampleSize: values.length };
};

const factsFromSnapshot = (snapshot: VideoPerformanceSnapshot) => ({
  snapshotId: snapshot.id,
  videoId: snapshot.videoId,
  title: snapshot.title,
  source: snapshot.source,
  collectedAt: snapshot.collectedAt.toISOString(),
  periodStart: snapshot.periodStart?.toISOString() ?? null,
  periodEnd: snapshot.periodEnd?.toISOString() ?? null,
  game: snapshot.game,
  series: snapshot.series,
  format: snapshot.format,
  ...Object.fromEntries(METRICS.map(([metric]) => [metric, snapshot[metric]])),
});

const outcomeStatus = (link: EditorialDecisionVideoLinkWithDetails): DecisionVideoLinkStatus => {
  if (link.outcomes.length > 0) return 'evaluated';
  const known = METRICS.filter(([metric]) => link.sourceSnapshot[metric] !== null).length;
  return known >= 2 ? 'evaluable' : 'awaiting_data';
};

const serializeLink = (link: EditorialDecisionVideoLinkWithDetails) => ({
  ...link,
  status: outcomeStatus(link),
});

export class DecisionOutcomeService {
  private decisionRepository?: EditorialDecisionRepository;
  private linkRepository?: EditorialDecisionVideoLinkRepository;
  private outcomeRepository?: EditorialDecisionOutcomeRepository;
  private snapshotRepository?: VideoPerformanceSnapshotRepository;

  constructor(
    decisionRepository?: EditorialDecisionRepository,
    linkRepository?: EditorialDecisionVideoLinkRepository,
    outcomeRepository?: EditorialDecisionOutcomeRepository,
    snapshotRepository?: VideoPerformanceSnapshotRepository,
    private readonly memory = new ChannelMemoryService(),
    private readonly transactionClient?: PrismaClient,
    private readonly transactionScope = false,
  ) {
    this.decisionRepository = decisionRepository;
    this.linkRepository = linkRepository;
    this.outcomeRepository = outcomeRepository;
    this.snapshotRepository = snapshotRepository;
  }

  private get decisions(): EditorialDecisionRepository {
    if (!this.decisionRepository) this.decisionRepository = new EditorialDecisionRepository(DatabaseService.client);
    return this.decisionRepository;
  }

  private get links(): EditorialDecisionVideoLinkRepository {
    if (!this.linkRepository) this.linkRepository = new EditorialDecisionVideoLinkRepository(DatabaseService.client);
    return this.linkRepository;
  }

  private get outcomes(): EditorialDecisionOutcomeRepository {
    if (!this.outcomeRepository) this.outcomeRepository = new EditorialDecisionOutcomeRepository(DatabaseService.client);
    return this.outcomeRepository;
  }

  private get snapshots(): VideoPerformanceSnapshotRepository {
    if (!this.snapshotRepository) this.snapshotRepository = new VideoPerformanceSnapshotRepository(DatabaseService.client);
    return this.snapshotRepository;
  }

  private async requireDecision(id: string): Promise<EditorialDecision> {
    const decision = await this.decisions.findById(normalizeId(id, 'decisionId'));
    if (!decision) throw new DecisionOutcomeDecisionNotFoundError();
    return decision;
  }

  private async requireLink(id: string): Promise<EditorialDecisionVideoLinkWithDetails> {
    const link = await this.links.findById(normalizeId(id, 'linkId'));
    if (!link) throw new DecisionOutcomeLinkNotFoundError();
    return link;
  }

  async linkVideo(decisionId: string, input: {
    snapshotId: string;
    origin?: string;
    notes?: string | null;
  }): Promise<{ link: ReturnType<typeof serializeLink>; created: boolean }> {
    const decision = await this.requireDecision(decisionId);
    const snapshot = await this.snapshots.findById(normalizeId(input.snapshotId, 'snapshotId'));
    if (!snapshot) throw new DecisionOutcomeSnapshotNotFoundError();
    if (decision.projectId !== snapshot.projectId) {
      throw new DecisionOutcomeLinkConflictError('snapshot does not belong to the decision project');
    }
    const origin = optionalText(input.origin, 'origin', 40) ?? 'manual';
    if (!['manual', 'youtube_sync'].includes(origin)) {
      throw new DecisionOutcomeValidationError('origin must be manual or youtube_sync');
    }
    const notes = optionalText(input.notes, 'notes', 1_000);
    const existing = await this.links.findByDecisionAndVideo(decision.id, snapshot.videoId);
    if (existing) return { link: serializeLink(existing), created: false };
    try {
      const created = await this.links.create({
        decisionId: decision.id,
        sourceSnapshotId: snapshot.id,
        videoId: snapshot.videoId,
        origin,
        notes,
      });
      const link = await this.links.findById(created.id);
      if (!link) throw new DecisionOutcomeError('Decision video link was not persisted');
      return { link: serializeLink(link), created: true };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const concurrent = await this.links.findByDecisionAndVideo(decision.id, snapshot.videoId);
        if (concurrent) return { link: serializeLink(concurrent), created: false };
      }
      throw error;
    }
  }

  async listLinks(decisionId: string): Promise<Array<ReturnType<typeof serializeLink>>> {
    const decision = await this.requireDecision(decisionId);
    return (await this.links.findByDecision(decision.id)).map(serializeLink);
  }

  async removeLink(decisionId: string, linkId: string): Promise<void> {
    const decision = await this.requireDecision(decisionId);
    const link = await this.requireLink(linkId);
    if (link.decisionId !== decision.id) {
      throw new DecisionOutcomeLinkConflictError('link does not belong to the decision');
    }
    if (link.outcomes.length > 0) {
      throw new DecisionOutcomeLinkConflictError('evaluated links cannot be removed');
    }
    await this.links.delete(link.id);
  }

  private compare(
    snapshot: VideoPerformanceSnapshot,
    history: readonly VideoPerformanceSnapshot[],
  ): { baseline: Record<string, unknown>; comparisons: MetricComparison[]; missingData: string[] } {
    const scopes = [
      snapshot.format ? ['format', history.filter(({ format }) => format === snapshot.format)] : null,
      snapshot.game ? ['game', history.filter(({ game }) => game === snapshot.game)] : null,
      ['channel', history],
    ].filter(Boolean) as Array<['format' | 'game' | 'channel', VideoPerformanceSnapshot[]]>;
    const baseline: Record<string, unknown> = {};
    const comparisons: MetricComparison[] = [];
    const missingData: string[] = [];
    for (const [metric, label, direction] of METRICS) {
      const value = snapshot[metric];
      if (value === null) {
        missingData.push(label);
        continue;
      }
      const candidates = scopes.map(([scope, records]) => ({ scope, ...baselineFor(records, metric) }));
      baseline[metric] = Object.fromEntries(candidates.map(({ scope, median: valueMedian, sampleSize }) => (
        [scope, { median: valueMedian, sampleSize }]
      )));
      const selected = candidates.find(({ median: valueMedian, sampleSize }) => valueMedian !== null && sampleSize >= 2);
      if (!selected || selected.median === null) {
        missingData.push(`${label} baseline`);
        continue;
      }
      const ratio = selected.median === 0 ? null : value / selected.median;
      let signal: MetricComparison['signal'] = 'neutral';
      if (ratio !== null) {
        if (direction === 'higher') {
          if (ratio >= 1.1) signal = 'supports';
          else if (ratio <= 0.9) signal = 'contradicts';
        } else {
          if (ratio <= 0.9) signal = 'supports';
          else if (ratio >= 1.1) signal = 'contradicts';
        }
      }
      comparisons.push({
        metric,
        label,
        value,
        baselineMedian: selected.median,
        baselineScope: selected.scope,
        sampleSize: selected.sampleSize,
        ratio,
        signal,
      });
    }
    return { baseline, comparisons, missingData: [...new Set(missingData)] };
  }

  async evaluate(linkId: string, snapshotId?: string | null): Promise<{
    outcome: EditorialDecisionOutcomeWithDetails;
    created: boolean;
  }> {
    const canUseDefaultClient = !this.decisionRepository
      && !this.linkRepository
      && !this.outcomeRepository
      && !this.snapshotRepository;
    const client = this.transactionClient ?? (canUseDefaultClient ? DatabaseService.client : null);
    if (!this.transactionScope && client) {
      return client.$transaction(async (transaction) => {
        const scopedClient = transaction as unknown as PrismaClient;
        const scopedSnapshots = new VideoPerformanceSnapshotRepository(scopedClient);
        const scopedMemory = new ChannelMemoryService(
          new ChannelInsightRepository(scopedClient),
          new PerformanceSignalRepository(scopedClient),
          scopedSnapshots,
        );
        const scopedService = new DecisionOutcomeService(
          new EditorialDecisionRepository(scopedClient),
          new EditorialDecisionVideoLinkRepository(scopedClient),
          new EditorialDecisionOutcomeRepository(scopedClient),
          scopedSnapshots,
          scopedMemory,
          undefined,
          true,
        );
        return scopedService.evaluate(linkId, snapshotId);
      });
    }
    const link = await this.requireLink(linkId);
    const snapshots = await this.snapshots.findAll({ videoId: link.videoId });
    const snapshot = snapshotId
      ? snapshots.find(({ id }) => id === snapshotId.trim()) ?? null
      : snapshots[0] ?? null;
    if (!snapshot) throw new DecisionOutcomeSnapshotNotFoundError();
    if (snapshot.videoId !== link.videoId) {
      throw new DecisionOutcomeLinkConflictError('snapshot does not belong to the linked video');
    }
    const decision = await this.requireDecision(link.decisionId);
    if (decision.projectId !== snapshot.projectId) {
      throw new DecisionOutcomeLinkConflictError('snapshot does not belong to the decision project');
    }
    const projectSnapshots = await this.snapshots.findAll({ projectId: decision.projectId });
    const history = projectSnapshots.filter(({ videoId }) => videoId !== snapshot.videoId);
    const { baseline, comparisons, missingData } = this.compare(snapshot, history);
    const supporting = comparisons.filter(({ signal }) => signal === 'supports');
    const contradicting = comparisons.filter(({ signal }) => signal === 'contradicts');
    let classification: DecisionOutcomeClassification = 'INCONCLUSIVE';
    if (comparisons.length >= 2) {
      if (supporting.length > 0 && contradicting.length > 0) classification = 'MIXED';
      else if (supporting.length >= 2) classification = 'POSITIVE';
      else if (contradicting.length >= 2) classification = 'NEGATIVE';
      else if (supporting.length + contradicting.length > 0) classification = 'MIXED';
    }
    const averageSamples = comparisons.length === 0
      ? 0
      : comparisons.reduce((sum, item) => sum + item.sampleSize, 0) / comparisons.length;
    const confidence = Math.min(
      classification === 'INCONCLUSIVE' ? 0.4 : 0.95,
      snapshot.confidence * Math.min(1, comparisons.length / 5) * Math.min(1, averageSamples / 5),
    );
    const summary = classification === 'POSITIVE'
      ? 'O vídeo superou referências internas em métricas suficientes para sustentar uma associação positiva.'
      : classification === 'NEGATIVE'
        ? 'O vídeo ficou abaixo de referências internas em métricas suficientes para sustentar uma associação negativa.'
        : classification === 'MIXED'
          ? 'O resultado foi misto: métricas diferentes apontam em direções distintas ou próximas da baseline.'
          : 'Os dados disponíveis ainda não são suficientes para avaliar o resultado da decisão.';
    const hypotheses = [
      ['game', snapshot.game],
      ['format', snapshot.format],
      ['series', snapshot.series],
      ['title', snapshot.title],
    ].flatMap(([element, value]) => value ? [{ element, value, conclusion: 'associated_not_causal' }] : []);
    const saved = await this.outcomes.upsert({
      decisionVideoLinkId: link.id,
      snapshotId: snapshot.id,
      windowStart: snapshot.periodStart,
      windowEnd: snapshot.periodEnd,
      baseline: baseline as Prisma.InputJsonValue,
      facts: factsFromSnapshot(snapshot) as Prisma.InputJsonValue,
      comparison: comparisons as unknown as Prisma.InputJsonValue,
      interpretation: {
        summary,
        causality: 'A associação observada não demonstra que a decisão causou o resultado.',
        originalRecommendation: decision.recommendation,
      },
      confidence,
      classification,
      supportingMetrics: supporting as unknown as Prisma.InputJsonValue,
      contradictingMetrics: contradicting as unknown as Prisma.InputJsonValue,
      missingData: missingData as Prisma.InputJsonValue,
      hypotheses: hypotheses as Prisma.InputJsonValue,
      evaluatedAt: new Date(),
    });
    const memoryRevision = classification === 'MIXED'
      ? 'weakened'
      : classification === 'INCONCLUSIVE' ? 'insufficient_data' : 'reinforced';
    const memoryConfidence = classification === 'MIXED' ? confidence * 0.75 : confidence;
    const learning = await this.memory.recordLearning({
      projectId: decision.projectId,
      category: 'decision_outcome',
      subject: `decision:${decision.id}:video:${link.videoId}`,
      statement: `${summary} Isso não prova causalidade de jogo, formato, título ou premissa isoladamente.`,
      confidence: memoryConfidence,
      classification: classification === 'INCONCLUSIVE' ? 'unknown' : 'inference',
      evidence: {
        outcomeId: saved.outcome.id,
        decisionId: decision.id,
        videoId: link.videoId,
        snapshotId: snapshot.id,
        classification,
        revision: memoryRevision,
        supportingMetrics: supporting.map(({ metric }) => metric),
        contradictingMetrics: contradicting.map(({ metric }) => metric),
        missingData,
        evaluatedAt: new Date().toISOString(),
      },
    });
    await this.outcomes.attachLearning(saved.outcome.id, learning.id);
    await this.decisions.registerOutcome(decision.id, snapshot.id, {
      assessment: classification.toLowerCase(),
      learning: summary,
      snapshotId: snapshot.id,
      videoId: snapshot.videoId,
      measuredAt: snapshot.collectedAt.toISOString(),
      confidence,
      causality: 'association_not_causation',
    });
    const outcome = await this.outcomes.findById(saved.outcome.id);
    if (!outcome) throw new DecisionOutcomeError('Decision outcome was not persisted');
    return { outcome, created: saved.created };
  }

  async getOutcome(id: string): Promise<EditorialDecisionOutcomeWithDetails | null> {
    return this.outcomes.findById(normalizeId(id, 'outcomeId'));
  }

  async listOutcomes(filters: {
    projectId?: string | null;
    conversationId?: string | null;
    decisionId?: string;
    videoId?: string;
    limit?: number;
  } = {}): Promise<EditorialDecisionOutcomeWithDetails[]> {
    const limit = filters.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new DecisionOutcomeValidationError('limit must be an integer from 1 to 50');
    }
    return this.outcomes.findAll({ ...filters, limit });
  }

  async evaluateAvailableForVideo(videoId: string): Promise<EditorialDecisionOutcomeWithDetails[]> {
    const normalizedVideoId = normalizeId(videoId, 'videoId');
    const links = await this.links.findByVideoId(normalizedVideoId);
    const evaluated: EditorialDecisionOutcomeWithDetails[] = [];
    for (const link of links) {
      evaluated.push((await this.evaluate(link.id)).outcome);
    }
    return evaluated;
  }
}
