import { DatabaseService } from '../../database/DatabaseService';
import { StrategicLearningRepository, type LearningOutcomeSource } from '../../database/repositories/StrategicLearningRepository';
import { analyzeStrategicLearning, STRATEGIC_LEARNING_DIMENSIONS, STRATEGIC_LEARNING_STATUSES,
  type StrategicLearningDimension, type StrategicLearningObservation } from '../../domains/strategic-learning';

export class StrategicLearningError extends Error { constructor(message: string) { super(message); this.name = 'StrategicLearningError'; } }
export class StrategicLearningValidationError extends StrategicLearningError { constructor(message: string) { super(message); this.name = 'StrategicLearningValidationError'; } }
export class StrategicLearningNotFoundError extends StrategicLearningError { constructor() { super('Strategic learning not found'); this.name = 'StrategicLearningNotFoundError'; } }

const normalizeId = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) throw new StrategicLearningValidationError(`${field} is invalid`);
  return value.trim();
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;
const stable = (value: unknown): string => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right))) : entry);
const dimensionValues = (outcome: LearningOutcomeSource): Array<[StrategicLearningDimension, string | null]> => [
  ['FORMAT', outcome.snapshot.format], ['SERIES', outcome.snapshot.series], ['GAME', outcome.snapshot.game],
  ['CONTENT_TYPE', outcome.item.candidateType], ['PRIORITY', outcome.item.priority],
  ['PUBLICATION_WEEKDAY', outcome.snapshot.publishedAt ? WEEKDAYS[outcome.snapshot.publishedAt.getUTCDay()] : null],
];
const comparisonContext = (outcome: LearningOutcomeSource) => {
  const benchmark = object(outcome.benchmark);
  return { format: benchmark.format ?? outcome.snapshot.format ?? null, windowHours: benchmark.windowHours ?? null,
    publicationAgeDays: benchmark.publicationAgeDays ?? null, strategy: benchmark.strategy ?? null };
};
const isUniqueConstraintError = (error: unknown): boolean => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');

export interface StrategicLearningListInput { projectId?: string | null; status?: string; dimension?: string; limit?: number; }

export class StrategicLearningService {
  private readonly refreshLocks = new Map<string, Promise<unknown>>();
  constructor(private readonly repository = new StrategicLearningRepository(DatabaseService.client), private readonly clock = () => new Date()) {}

  async refresh(projectId?: string | null) {
    if (projectId !== undefined && projectId !== null) projectId = normalizeId(projectId, 'projectId');
    const lockKey = projectId ?? '__unscoped__';
    const previous = this.refreshLocks.get(lockKey) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const outcomes = await this.repository.findEligibleOutcomes(projectId);
      const groups = new Map<string, StrategicLearningObservation[]>();
      for (const outcome of outcomes) {
        const context = comparisonContext(outcome);
        for (const [dimension, subject] of dimensionValues(outcome)) {
          if (!subject?.trim()) continue;
          const groupKey = stable({ projectId: outcome.projectId, dimension, subject: subject.trim(), context });
          const entries = groups.get(groupKey) ?? [];
          entries.push({ outcomeId: outcome.id, videoId: outcome.videoId, observedAt: outcome.observedAt,
            confidence: outcome.confidence, freshness: outcome.freshness, classification: outcome.classification,
            dimension, subject: subject.trim(), comparisonContext: context, benchmark: outcome.benchmark });
          groups.set(groupKey, entries);
        }
      }
      const analyses = [...groups.values()].flatMap((entries) => {
        const sourceOutcome = outcomes.find(({ id }) => id === entries[0].outcomeId);
        const analysisProjectId = projectId !== undefined ? projectId : sourceOutcome?.projectId ?? null;
        const analysis = analyzeStrategicLearning(analysisProjectId, entries, this.clock());
        return analysis ? [analysis] : [];
      }).sort((left, right) => left.key.localeCompare(right.key));
      const changes = { created: 0, updated: 0, unchanged: 0 };
      const learnings = [];
      for (const analysis of analyses) {
        let saved;
        try { saved = await this.repository.saveAnalysis(analysis); }
        catch (error) { if (!isUniqueConstraintError(error)) throw error; saved = await this.repository.saveAnalysis(analysis); }
        changes[saved.change] += 1; learnings.push(saved.learning);
      }
      const retired = await this.repository.markAbsentAsStale(projectId, analyses.map(({ key }) => key), this.clock());
      return { learnings, ...changes, retired, insufficientData: analyses.length === 0 };
    });
    this.refreshLocks.set(lockKey, operation);
    try { return await operation; }
    finally { if (this.refreshLocks.get(lockKey) === operation) this.refreshLocks.delete(lockKey); }
  }

  async list(input: StrategicLearningListInput = {}) {
    if (input.projectId !== undefined && input.projectId !== null) input.projectId = normalizeId(input.projectId, 'projectId');
    if (input.status && !STRATEGIC_LEARNING_STATUSES.includes(input.status as never)) throw new StrategicLearningValidationError('status is invalid');
    if (input.dimension && !STRATEGIC_LEARNING_DIMENSIONS.includes(input.dimension as never)) throw new StrategicLearningValidationError('dimension is invalid');
    if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200)) throw new StrategicLearningValidationError('limit is invalid');
    return this.repository.findAll(input);
  }
  async get(id: string) { const learning = await this.repository.findById(normalizeId(id, 'learningId')); if (!learning) throw new StrategicLearningNotFoundError(); return learning; }
  async evidence(id: string) { await this.get(id); return this.repository.findEvidence(id.trim()); }
  async history(id: string) { await this.get(id); return this.repository.findHistory(id.trim()); }
  async related(kind: 'itemId' | 'planId' | 'outcomeId' | 'videoId', id: string) { return this.repository.findRelated({ [kind]: normalizeId(id, kind) }); }
  async listForPlanner(projectId: string | null, limit = 5) {
    const learnings = await this.repository.findAll({ projectId, limit: Math.min(10, limit) });
    return learnings.filter(({ status }) => ['SUPPORTED', 'EMERGING', 'CONTRADICTED'].includes(status)).slice(0, limit)
      .map(({ id, dimension, subject, description, status, confidence, freshness, limitations }) => ({ id, dimension, subject, description, status, confidence, freshness, limitations }));
  }
}
