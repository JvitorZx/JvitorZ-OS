import type { PlanningExecutionEvent, VideoPerformanceSnapshot } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { PlannedContentItemRepository, type PlannedContentItemWithPlan } from '../../database/repositories/PlannedContentItemRepository';
import { PlanningExecutionRepository } from '../../database/repositories/PlanningExecutionRepository';
import {
  PlanningOutcomeRepository,
  type PlanningOutcomeLinkWithDetails,
} from '../../database/repositories/PlanningOutcomeRepository';
import { VideoPerformanceSnapshotRepository } from '../../database/repositories/VideoPerformanceSnapshotRepository';
import { evaluateStrategicOutcome } from '../../domains/strategic-planning';

export class StrategicOutcomeError extends Error {
  constructor(message: string) { super(message); this.name = 'StrategicOutcomeError'; }
}
export class StrategicOutcomeValidationError extends StrategicOutcomeError {
  constructor(message: string) { super(message); this.name = 'StrategicOutcomeValidationError'; }
}
export class StrategicOutcomeItemNotFoundError extends StrategicOutcomeError {
  constructor() { super('Planned content item not found'); this.name = 'StrategicOutcomeItemNotFoundError'; }
}
export class StrategicOutcomeSnapshotNotFoundError extends StrategicOutcomeError {
  constructor() { super('Performance snapshot not found'); this.name = 'StrategicOutcomeSnapshotNotFoundError'; }
}
export class StrategicOutcomeNotFoundError extends StrategicOutcomeError {
  constructor() { super('Planning outcome not found'); this.name = 'StrategicOutcomeNotFoundError'; }
}
export class StrategicOutcomeConflictError extends StrategicOutcomeError {
  constructor(message: string) { super(message); this.name = 'StrategicOutcomeConflictError'; }
}
export class StrategicOutcomeNotReadyError extends StrategicOutcomeError {
  constructor(message: string) { super(message); this.name = 'StrategicOutcomeNotReadyError'; }
}

const normalizeId = (value: string, field: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) {
    throw new StrategicOutcomeValidationError(`${field} is invalid`);
  }
  return value.trim();
};

const normalizeReason = (value: string | null | undefined, required = false): string | null => {
  if (value === undefined || value === null || value === '') {
    if (required) throw new StrategicOutcomeValidationError('reason is required');
    return null;
  }
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > 500) {
    throw new StrategicOutcomeValidationError('reason is invalid');
  }
  return value.trim();
};

const isUniqueConstraintError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';

const candidateFrom = (snapshot: VideoPerformanceSnapshot, linkedItemId: string | null) => ({
  snapshotId: snapshot.id,
  videoId: snapshot.videoId,
  title: snapshot.title,
  format: snapshot.format,
  publishedAt: snapshot.publishedAt,
  periodStart: snapshot.periodStart,
  periodEnd: snapshot.periodEnd,
  collectedAt: snapshot.collectedAt,
  confidence: snapshot.confidence,
  linkedItemId,
});

export class StrategicOutcomeService {
  private readonly associationLocks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly items = new PlannedContentItemRepository(DatabaseService.client),
    private readonly executions = new PlanningExecutionRepository(DatabaseService.client),
    private readonly outcomes = new PlanningOutcomeRepository(DatabaseService.client),
    private readonly snapshots = new VideoPerformanceSnapshotRepository(DatabaseService.client),
    private readonly clock = () => new Date(),
  ) {}

  private async requireItem(id: string): Promise<PlannedContentItemWithPlan> {
    const item = await this.items.findById(normalizeId(id, 'itemId'));
    if (!item) throw new StrategicOutcomeItemNotFoundError();
    return item;
  }

  private async requireCompletedExecution(item: PlannedContentItemWithPlan): Promise<PlanningExecutionEvent> {
    if (item.executionState !== 'completed') {
      throw new StrategicOutcomeNotReadyError('Only completed planning items can be linked to a published video');
    }
    const execution = await this.executions.findLatestCompleted(item.id);
    if (!execution) throw new StrategicOutcomeNotReadyError('Completed execution event is required before linking a video');
    return execution;
  }

  async listVideoCandidates(itemId: string) {
    const item = await this.requireItem(itemId);
    await this.requireCompletedExecution(item);
    const snapshots = await this.snapshots.findAll({ projectId: item.plan.projectId });
    const latest = new Map<string, VideoPerformanceSnapshot>();
    for (const snapshot of snapshots) {
      const existing = latest.get(snapshot.videoId);
      if (!existing || existing.collectedAt < snapshot.collectedAt) latest.set(snapshot.videoId, snapshot);
    }
    const candidates = await Promise.all([...latest.values()].map(async (snapshot) => {
      const active = await this.outcomes.findActiveLinkByVideo(snapshot.videoId);
      return candidateFrom(snapshot, active?.itemId ?? null);
    }));
    return candidates.sort((left, right) => {
      const leftTime = left.publishedAt?.getTime() ?? left.collectedAt.getTime();
      const rightTime = right.publishedAt?.getTime() ?? right.collectedAt.getTime();
      return rightTime - leftTime || left.videoId.localeCompare(right.videoId);
    });
  }

  async associateVideo(itemId: string, input: { snapshotId: string; reason?: string | null }) {
    const item = await this.requireItem(itemId);
    const execution = await this.requireCompletedExecution(item);
    const snapshot = await this.snapshots.findById(normalizeId(input.snapshotId, 'snapshotId'));
    if (!snapshot) throw new StrategicOutcomeSnapshotNotFoundError();
    if (snapshot.projectId !== item.plan.projectId) {
      throw new StrategicOutcomeConflictError('Snapshot does not belong to the planning project');
    }
    const current = await this.outcomes.findActiveLinkByItem(item.id);
    const reason = normalizeReason(input.reason, Boolean(current && current.videoId !== snapshot.videoId));
    const lockKey = `${item.id}:${snapshot.videoId}`;
    const previous = this.associationLocks.get(lockKey) ?? Promise.resolve();
    const operation = previous.then(async () => {
      try {
        return await this.outcomes.associate({
          projectId: item.plan.projectId, planId: item.planId, itemId: item.id,
          executionEventId: execution.id, sourceSnapshotId: snapshot.id, videoId: snapshot.videoId,
          videoTitle: snapshot.title, publishedAt: snapshot.publishedAt, reason, linkedAt: this.clock(),
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          const sameItem = await this.outcomes.findActiveLinkByItem(item.id);
          if (sameItem?.videoId === snapshot.videoId) return { link: sameItem, created: false, replaced: false };
          const sameVideo = await this.outcomes.findActiveLinkByVideo(snapshot.videoId);
          if (sameVideo) throw new StrategicOutcomeConflictError('Video is already linked to another planning item');
        }
        throw error;
      }
    });
    this.associationLocks.set(lockKey, operation);
    try { return await operation; }
    finally { if (this.associationLocks.get(lockKey) === operation) this.associationLocks.delete(lockKey); }
  }

  async unlinkVideo(itemId: string, reason: string) {
    const item = await this.requireItem(itemId);
    const unlinked = await this.outcomes.unlink(item.id, normalizeReason(reason, true) as string, this.clock());
    if (!unlinked) throw new StrategicOutcomeNotFoundError();
    return unlinked;
  }

  async getItemOutcome(itemId: string) {
    const item = await this.requireItem(itemId);
    return { itemId: item.id, planId: item.planId, executionState: item.executionState, ...(await this.outcomes.findBundleByItem(item.id)) };
  }

  async captureOutcome(itemId: string, snapshotId?: string | null) {
    const item = await this.requireItem(itemId);
    const execution = await this.requireCompletedExecution(item);
    const link = await this.outcomes.findActiveLinkByItem(item.id);
    if (!link) throw new StrategicOutcomeNotFoundError();
    const videoSnapshots = await this.snapshots.findAll({ videoId: link.videoId });
    const requestedId = snapshotId ? normalizeId(snapshotId, 'snapshotId') : null;
    const snapshot = requestedId ? videoSnapshots.find(({ id }) => id === requestedId) ?? null : videoSnapshots[0] ?? null;
    if (!snapshot) throw new StrategicOutcomeSnapshotNotFoundError();
    if (snapshot.projectId !== item.plan.projectId) {
      throw new StrategicOutcomeConflictError('Snapshot does not belong to the planning project');
    }
    const history = await this.snapshots.findAll({ projectId: item.plan.projectId });
    const evaluatedAt = this.clock();
    const evaluation = evaluateStrategicOutcome(snapshot, history, evaluatedAt);
    try {
      const saved = await this.outcomes.saveOutcome({
        projectId: item.plan.projectId, planId: item.planId, itemId: item.id,
        executionEventId: execution.id, linkId: link.id, snapshotId: snapshot.id, videoId: snapshot.videoId,
        observedAt: snapshot.collectedAt, windowStart: snapshot.periodStart, windowEnd: snapshot.periodEnd,
        freshness: evaluation.freshness, dataQuality: evaluation.dataQuality, metrics: evaluation.metrics,
        benchmark: evaluation.benchmark, comparison: evaluation.comparison, evidence: evaluation.evidence,
        classification: evaluation.classification, confidence: evaluation.confidence,
        limitations: evaluation.limitations, missingData: evaluation.missingData, evaluatedAt,
      });
      const outcome = await this.outcomes.findOutcomeById(saved.outcome.id);
      if (!outcome) throw new StrategicOutcomeError('Planning outcome was not persisted');
      return { outcome, created: saved.created };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const existing = await this.outcomes.findOutcomeByLinkAndSnapshot(link.id, snapshot.id);
        if (existing) {
          const outcome = await this.outcomes.findOutcomeById(existing.id);
          if (outcome) return { outcome, created: false };
        }
      }
      throw error;
    }
  }

  async getOutcome(id: string) {
    const outcome = await this.outcomes.findOutcomeById(normalizeId(id, 'outcomeId'));
    if (!outcome) throw new StrategicOutcomeNotFoundError();
    return outcome;
  }
}
