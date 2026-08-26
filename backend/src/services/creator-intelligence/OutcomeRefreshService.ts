import { createHash } from 'node:crypto';
import type { EditorialDecisionOutcome, Prisma, PrismaClient, VideoPerformanceSnapshot } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { ChannelInsightRepository } from '../../database/repositories/ChannelInsightRepository';
import { EditorialDecisionRepository } from '../../database/repositories/EditorialDecisionRepository';
import {
  EditorialDecisionOutcomeRepository,
  type EditorialDecisionOutcomeWithDetails,
} from '../../database/repositories/EditorialDecisionOutcomeRepository';
import {
  EditorialDecisionOutcomeReviewRepository,
  type OutcomeReviewWithDetails,
} from '../../database/repositories/EditorialDecisionOutcomeReviewRepository';
import { EditorialDecisionVideoLinkRepository } from '../../database/repositories/EditorialDecisionVideoLinkRepository';
import { PerformanceSignalRepository } from '../../database/repositories/PerformanceSignalRepository';
import { VideoPerformanceSnapshotRepository } from '../../database/repositories/VideoPerformanceSnapshotRepository';
import { ChannelMemoryService } from './ChannelMemoryService';
import { DecisionOutcomeService } from './DecisionOutcomeService';

export type OutcomeReviewStateName = 'current' | 'review_available' | 'stale' | 'insufficient_data';

export interface OutcomeReviewState {
  outcome: EditorialDecisionOutcomeWithDetails;
  state: OutcomeReviewStateName;
  reason: string;
  lastEvaluationAt: Date;
  evaluatedSnapshotId: string;
  latestSnapshotId: string;
  latestDataAt: Date;
  changedMetrics: string[];
  baselineChanged: boolean;
  nextReviewAt: null;
}

export interface OutcomeRefreshResult {
  status: 'reviewed' | 'unchanged' | 'skipped' | 'failed';
  state: OutcomeReviewState;
  review?: OutcomeReviewWithDetails;
}

export class OutcomeRefreshValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutcomeRefreshValidationError';
  }
}

export class OutcomeRefreshNotFoundError extends Error {
  constructor() {
    super('Decision outcome not found');
    this.name = 'OutcomeRefreshNotFoundError';
  }
}

const METRICS = [
  'views', 'engagedViews', 'impressions', 'ctr', 'watchTimeMinutes',
  'averageViewDurationSeconds', 'averageViewPercentage', 'subscribersGained',
  'subscribersLost', 'likes', 'comments',
] as const;

type MetricName = (typeof METRICS)[number];

const normalizeId = (value: string, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new OutcomeRefreshValidationError(`${field} is required`);
  return value.trim();
};

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const currentFacts = (snapshot: VideoPerformanceSnapshot) => ({
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
  ...Object.fromEntries(METRICS.map((metric) => [metric, snapshot[metric]])),
});

const currentBaseline = (snapshot: VideoPerformanceSnapshot, history: VideoPerformanceSnapshot[]) => {
  const scopes: Array<[string, VideoPerformanceSnapshot[]]> = [
    ...(snapshot.format ? [['format', history.filter((item) => item.format === snapshot.format)] as [string, VideoPerformanceSnapshot[]]] : []),
    ...(snapshot.game ? [['game', history.filter((item) => item.game === snapshot.game)] as [string, VideoPerformanceSnapshot[]]] : []),
    ['channel', history],
  ];
  return Object.fromEntries(METRICS.flatMap((metric) => {
    if (snapshot[metric] === null) return [];
    return [[metric, Object.fromEntries(scopes.map(([scope, records]) => {
      const values = records.flatMap((item) => typeof item[metric] === 'number' ? [item[metric] as number] : []);
      return [scope, { median: median(values), sampleSize: values.length }];
    }))]];
  }));
};

const isUniqueError = (error: unknown): boolean =>
  !!error && typeof error === 'object' && 'code' in error && error.code === 'P2002';

export class OutcomeRefreshService {
  private outcomeRepository?: EditorialDecisionOutcomeRepository;
  private reviewRepository?: EditorialDecisionOutcomeReviewRepository;
  private snapshotRepository?: VideoPerformanceSnapshotRepository;
  private readonly active = new Map<string, Promise<OutcomeRefreshResult>>();

  constructor(
    outcomeRepository?: EditorialDecisionOutcomeRepository,
    reviewRepository?: EditorialDecisionOutcomeReviewRepository,
    snapshotRepository?: VideoPerformanceSnapshotRepository,
    private readonly evaluator = new DecisionOutcomeService(),
    private readonly transactionClient?: PrismaClient,
  ) {
    this.outcomeRepository = outcomeRepository;
    this.reviewRepository = reviewRepository;
    this.snapshotRepository = snapshotRepository;
  }

  private get outcomes() {
    if (!this.outcomeRepository) this.outcomeRepository = new EditorialDecisionOutcomeRepository(DatabaseService.client);
    return this.outcomeRepository;
  }

  private get reviews() {
    if (!this.reviewRepository) this.reviewRepository = new EditorialDecisionOutcomeReviewRepository(DatabaseService.client);
    return this.reviewRepository;
  }

  private get snapshots() {
    if (!this.snapshotRepository) this.snapshotRepository = new VideoPerformanceSnapshotRepository(DatabaseService.client);
    return this.snapshotRepository;
  }

  async inspect(outcomeId: string): Promise<OutcomeReviewState> {
    const outcome = await this.outcomes.findById(normalizeId(outcomeId, 'outcomeId'));
    if (!outcome) throw new OutcomeRefreshNotFoundError();
    const linkOutcomes = await this.outcomes.findByLink(outcome.decisionVideoLinkId);
    const videoSnapshots = await this.snapshots.findAll({ videoId: outcome.decisionVideoLink.videoId });
    const latestSnapshot = videoSnapshots[0] ?? outcome.snapshot;
    const isLatestOutcome = linkOutcomes[0]?.id === outcome.id;
    const projectSnapshots = await this.snapshots.findAll({
      projectId: outcome.decisionVideoLink.decision.projectId,
    });
    const history = projectSnapshots.filter(({ videoId }) => videoId !== latestSnapshot.videoId);
    const facts = currentFacts(latestSnapshot);
    const baseline = currentBaseline(latestSnapshot, history);
    const previousFacts = outcome.facts as Record<string, unknown>;
    const changedMetrics = METRICS.filter((metric) => previousFacts?.[metric] !== latestSnapshot[metric]);
    const baselineChanged = canonical(outcome.baseline) !== canonical(baseline);
    let state: OutcomeReviewStateName;
    let reason: string;
    if (!isLatestOutcome) {
      state = 'stale';
      reason = 'A newer outcome already exists for this decision and video.';
    } else if (latestSnapshot.id !== outcome.snapshotId) {
      state = 'review_available';
      reason = 'A newer performance snapshot is available.';
    } else if (changedMetrics.length > 0) {
      state = 'review_available';
      reason = changedMetrics.some((metric) => previousFacts?.[metric] === null && latestSnapshot[metric] !== null)
        ? 'Previously missing performance data is now available.'
        : 'Relevant performance metrics changed.';
    } else if (baselineChanged) {
      state = 'review_available';
      reason = 'The relevant performance baseline changed.';
    } else if (outcome.classification === 'INCONCLUSIVE') {
      state = 'insufficient_data';
      reason = 'No new sufficient evidence is available.';
    } else {
      state = 'current';
      reason = 'The outcome reflects the latest relevant evidence.';
    }
    return {
      outcome,
      state,
      reason,
      lastEvaluationAt: outcome.evaluatedAt,
      evaluatedSnapshotId: outcome.snapshotId,
      latestSnapshotId: latestSnapshot.id,
      latestDataAt: latestSnapshot.collectedAt,
      changedMetrics,
      baselineChanged,
      nextReviewAt: null,
    };
  }

  async listStates(): Promise<OutcomeReviewState[]> {
    const all = await this.outcomes.findAll({ limit: 50 });
    const byLink = new Map<string, EditorialDecisionOutcomeWithDetails>();
    for (const outcome of all) {
      if (!byLink.has(outcome.decisionVideoLinkId)) byLink.set(outcome.decisionVideoLinkId, outcome);
    }
    const latest = [...byLink.values()];
    return Promise.all(latest.map((outcome) => this.inspect(outcome.id)));
  }

  async listReviewable(): Promise<OutcomeReviewState[]> {
    return (await this.listStates()).filter(({ state }) => state === 'review_available');
  }

  async history(outcomeId: string): Promise<OutcomeReviewWithDetails[]> {
    await this.inspect(outcomeId);
    return this.reviews.findByOutcome(normalizeId(outcomeId, 'outcomeId'));
  }

  async refresh(outcomeId: string): Promise<OutcomeRefreshResult> {
    const id = normalizeId(outcomeId, 'outcomeId');
    const running = this.active.get(id);
    if (running) return running;
    const operation = this.performRefresh(id).finally(() => this.active.delete(id));
    this.active.set(id, operation);
    return operation;
  }

  private async performRefresh(outcomeId: string): Promise<OutcomeRefreshResult> {
    const state = await this.inspect(outcomeId);
    if (state.state !== 'review_available') return { status: 'skipped', state };
    const currentSnapshot = await this.snapshots.findById(state.latestSnapshotId);
    if (!currentSnapshot) throw new OutcomeRefreshNotFoundError();
    const fingerprint = createHash('sha256').update(canonical({
      outcomeId,
      facts: currentFacts(currentSnapshot),
      baselineChanged: state.baselineChanged,
    })).digest('hex');
    let review = await this.reviews.findByKey(fingerprint);
    let claimed = false;
    if (review?.status === 'reviewed' || review?.status === 'unchanged') {
      return { status: review.status, state: await this.inspect(review.resultOutcomeId ?? outcomeId), review };
    }
    if (!review) {
      try {
        const created = await this.reviews.create({
          sourceOutcomeId: outcomeId,
          previousSnapshotId: state.evaluatedSnapshotId,
          currentSnapshotId: state.latestSnapshotId,
          reviewKey: fingerprint,
          reason: state.reason,
          previousClassification: state.outcome.classification,
          previousConfidence: state.outcome.confidence,
          changedMetrics: state.changedMetrics as Prisma.InputJsonValue,
          previousState: {
            facts: state.outcome.facts,
            baseline: state.outcome.baseline,
            comparison: state.outcome.comparison,
            interpretation: state.outcome.interpretation,
          } as Prisma.InputJsonValue,
        });
        review = await this.reviews.findByKey(created.reviewKey);
        claimed = true;
      } catch (error) {
        if (!isUniqueError(error)) throw error;
        review = await this.reviews.findByKey(fingerprint);
      }
    }
    if (!review) throw new Error('Outcome review was not persisted');
    if (review.status === 'pending' && !claimed) {
      return { status: 'skipped', state, review };
    }
    try {
      const { evaluated, completed, status } = await this.evaluateAndComplete(review, state);
      return { status, state: await this.inspect(evaluated.outcome.id), review: completed };
    } catch (error) {
      const failed = await this.reviews.fail(review.id, error instanceof Error ? error.name : 'UnknownError');
      return { status: 'failed', state, review: failed };
    }
  }

  private async evaluateAndComplete(
    review: OutcomeReviewWithDetails,
    state: OutcomeReviewState,
  ): Promise<{
    evaluated: Awaited<ReturnType<DecisionOutcomeService['evaluate']>>;
    completed: OutcomeReviewWithDetails;
    status: 'reviewed' | 'unchanged';
  }> {
    const persist = async (
      evaluator: Pick<DecisionOutcomeService, 'evaluate'>,
      reviewRepository: EditorialDecisionOutcomeReviewRepository,
    ) => {
      const evaluated = await evaluator.evaluate(
        state.outcome.decisionVideoLinkId,
        state.latestSnapshotId,
      );
      const status = evaluated.outcome.classification === state.outcome.classification
        ? 'unchanged' as const
        : 'reviewed' as const;
      const completed = await reviewRepository.complete(review.id, {
        resultOutcomeId: evaluated.outcome.id,
        status,
        currentClassification: evaluated.outcome.classification,
        currentConfidence: evaluated.outcome.confidence,
        currentState: {
          facts: evaluated.outcome.facts,
          baseline: evaluated.outcome.baseline,
          comparison: evaluated.outcome.comparison,
          interpretation: evaluated.outcome.interpretation,
        } as Prisma.InputJsonValue,
      });
      return { evaluated, completed, status };
    };

    const canUseDefaultClient = !this.outcomeRepository
      && !this.reviewRepository
      && !this.snapshotRepository;
    const client = this.transactionClient ?? (canUseDefaultClient ? DatabaseService.client : null);
    if (!client) return persist(this.evaluator, this.reviews);

    return client.$transaction(async (transaction) => {
      const scopedClient = transaction as unknown as PrismaClient;
      const scopedSnapshots = new VideoPerformanceSnapshotRepository(scopedClient);
      const scopedMemory = new ChannelMemoryService(
        new ChannelInsightRepository(scopedClient),
        new PerformanceSignalRepository(scopedClient),
        scopedSnapshots,
      );
      const scopedEvaluator = new DecisionOutcomeService(
        new EditorialDecisionRepository(scopedClient),
        new EditorialDecisionVideoLinkRepository(scopedClient),
        new EditorialDecisionOutcomeRepository(scopedClient),
        scopedSnapshots,
        scopedMemory,
        undefined,
        true,
      );
      return persist(scopedEvaluator, new EditorialDecisionOutcomeReviewRepository(scopedClient));
    });
  }

  async refreshAvailable(): Promise<{
    reviewed: number;
    unchanged: number;
    skipped: number;
    failed: number;
    results: OutcomeRefreshResult[];
  }> {
    const reviewable = await this.listReviewable();
    const results: OutcomeRefreshResult[] = [];
    for (const state of reviewable) {
      try {
        results.push(await this.refresh(state.outcome.id));
      } catch {
        results.push({ status: 'failed', state });
      }
    }
    return {
      reviewed: results.filter(({ status }) => status === 'reviewed').length,
      unchanged: results.filter(({ status }) => status === 'unchanged').length,
      skipped: results.filter(({ status }) => status === 'skipped').length,
      failed: results.filter(({ status }) => status === 'failed').length,
      results,
    };
  }

  async getOperationalStatus() {
    const states = await this.listStates();
    const recentFailures = await this.reviews.countRecentFailures(new Date(Date.now() - 24 * 60 * 60 * 1_000));
    return {
      current: states.filter(({ state }) => state === 'current').length,
      reviewAvailable: states.filter(({ state }) => state === 'review_available').length,
      stale: states.filter(({ state }) => state === 'stale').length,
      insufficientData: states.filter(({ state }) => state === 'insufficient_data').length,
      recentFailures,
    };
  }
}
