import { DatabaseService } from '../../database/DatabaseService';
import { ExperimentObservationRepository } from '../../database/repositories/ExperimentObservationRepository';
import { ExperimentRepository } from '../../database/repositories/ExperimentRepository';
import { analyzeStrategicExperiment, EXPERIMENT_METRICS, EXPERIMENT_METRIC_DIRECTIONS, EXPERIMENT_STATUSES,
  type CreateExperimentInput, type ExperimentMetricDirection, type ExperimentMetricName } from '../../domains/strategic-experimentation';
import type { StrategicLearningService } from '../strategic-learning';
import { StrategicLearningService as DefaultStrategicLearningService } from '../strategic-learning';

export class ExperimentationError extends Error { constructor(message: string) { super(message); this.name = 'ExperimentationError'; } }
export class ExperimentationValidationError extends ExperimentationError { constructor(message: string) { super(message); this.name = 'ExperimentationValidationError'; } }
export class ExperimentNotFoundError extends ExperimentationError { constructor() { super('Strategic experiment not found'); this.name = 'ExperimentNotFoundError'; } }
export class ExperimentObservationNotFoundError extends ExperimentationError { constructor() { super('Planning outcome not found'); this.name = 'ExperimentObservationNotFoundError'; } }
export class ExperimentConflictError extends ExperimentationError { constructor(message: string) { super(message); this.name = 'ExperimentConflictError'; } }
export class ExperimentNotReadyError extends ExperimentationError { constructor(message: string) { super(message); this.name = 'ExperimentNotReadyError'; } }

const id = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) throw new ExperimentationValidationError(`${field} is invalid`);
  return value.trim();
};
const text = (value: unknown, field: string, max = 1000): string => {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > max) throw new ExperimentationValidationError(`${field} is invalid`);
  return value.trim();
};
const optionalText = (value: unknown, field: string, max = 1000): string | null => value == null || value === '' ? null : text(value, field, max);
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const isUnique = (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');

export interface ExperimentListInput { projectId?: string | null; status?: string; limit?: number; }

export class ExperimentationService {
  private readonly analysisLocks = new Map<string, Promise<unknown>>();
  private readonly observationLocks = new Map<string, Promise<unknown>>();
  constructor(
    private readonly experiments = new ExperimentRepository(DatabaseService.client),
    private readonly observations = new ExperimentObservationRepository(DatabaseService.client),
    private readonly learnings: Pick<StrategicLearningService, 'refresh' | 'related'> = new DefaultStrategicLearningService(),
    private readonly clock = () => new Date(),
  ) {}

  async create(input: CreateExperimentInput) {
    const variants = Array.isArray(input.variants) ? input.variants : [];
    if (variants.length !== 2) throw new ExperimentationValidationError('exactly two variants are required');
    const keys = variants.map((variant) => id(variant.key, 'variant key').toUpperCase());
    if (new Set(keys).size !== keys.length) throw new ExperimentationValidationError('variant keys must be unique');
    const expectedVariantKey = id(input.expectedVariantKey, 'expectedVariantKey').toUpperCase();
    if (!keys.includes(expectedVariantKey)) throw new ExperimentationValidationError('expectedVariantKey must identify a variant');
    if (!EXPERIMENT_METRICS.includes(input.primaryMetric as never)) throw new ExperimentationValidationError('primaryMetric is unsupported');
    const secondaryMetrics = input.secondaryMetrics ?? [];
    if (!Array.isArray(secondaryMetrics) || secondaryMetrics.some((metric) => !EXPERIMENT_METRICS.includes(metric as never))) throw new ExperimentationValidationError('secondaryMetrics contains unsupported metric');
    const metricDirection = input.metricDirection ?? 'HIGHER_BETTER';
    if (!EXPERIMENT_METRIC_DIRECTIONS.includes(metricDirection as never)) throw new ExperimentationValidationError('metricDirection is invalid');
    const constraints = input.constraints ?? [];
    if (!Array.isArray(constraints) || constraints.some((entry) => !entry || typeof entry !== 'object')) throw new ExperimentationValidationError('constraints is invalid');
    return this.experiments.create({ ...input, title: text(input.title, 'title', 180),
      description: optionalText(input.description, 'description', 1000), hypothesis: text(input.hypothesis, 'hypothesis', 2000),
      expectedVariantKey, primaryMetric: input.primaryMetric as ExperimentMetricName, secondaryMetrics: secondaryMetrics as ExperimentMetricName[],
      metricDirection: metricDirection as ExperimentMetricDirection,
      projectId: input.projectId == null ? null : id(input.projectId, 'projectId'),
      sourceLearningId: input.sourceLearningId == null ? null : id(input.sourceLearningId, 'sourceLearningId'),
      risk: optionalText(input.risk, 'risk', 500), context: object(input.context), comparisonCriterion: object(input.comparisonCriterion),
      variants: variants.map((variant, index) => ({ key: keys[index], label: text(variant.label, 'variant label', 180),
        description: optionalText(variant.description, 'variant description', 1000),
        plannedItemId: variant.plannedItemId == null ? null : id(variant.plannedItemId, 'plannedItemId'),
        executionEventId: variant.executionEventId == null ? null : id(variant.executionEventId, 'executionEventId') })),
      constraints: constraints.map((entry) => ({ code: id(entry.code, 'constraint code').toUpperCase(), summary: text(entry.summary, 'constraint summary', 500), blocking: Boolean(entry.blocking) })),
    });
  }

  async list(input: ExperimentListInput = {}) {
    if (input.projectId != null) input.projectId = id(input.projectId, 'projectId');
    if (input.status && !EXPERIMENT_STATUSES.includes(input.status as never)) throw new ExperimentationValidationError('status is invalid');
    if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200)) throw new ExperimentationValidationError('limit is invalid');
    return this.experiments.findAll(input);
  }
  async get(experimentId: string) { const experiment = await this.experiments.findById(id(experimentId, 'experimentId')); if (!experiment) throw new ExperimentNotFoundError(); return experiment; }

  async start(experimentId: string) {
    const experiment = await this.get(experimentId);
    if (!['DRAFT', 'READY', 'WAITING_FOR_DATA'].includes(experiment.status)) throw new ExperimentConflictError('experiment cannot be started from its current state');
    if (experiment.constraints.some(({ blocking }) => blocking)) throw new ExperimentNotReadyError('experiment has blocking constraints');
    return this.experiments.updateStatus(experiment.id, 'RUNNING', { startedAt: experiment.startedAt ?? this.clock() });
  }

  async cancel(experimentId: string, reason?: string | null) {
    const experiment = await this.get(experimentId);
    if (experiment.status === 'CANCELLED') return experiment;
    if (['COMPLETED', 'INCONCLUSIVE'].includes(experiment.status)) throw new ExperimentConflictError('completed experiment cannot be cancelled');
    return this.experiments.updateStatus(experiment.id, 'CANCELLED', { endedAt: this.clock(), reason: optionalText(reason, 'reason', 500) });
  }

  async linkVariant(experimentId: string, variantId: string, input: { plannedItemId?: string | null; executionEventId?: string | null }) {
    const experiment = await this.get(experimentId); const variant = experiment.variants.find(({ id: value }) => value === id(variantId, 'variantId'));
    if (!variant) throw new ExperimentationValidationError('variant does not belong to experiment');
    return this.experiments.linkVariant(variant.id, input.plannedItemId == null ? null : id(input.plannedItemId, 'plannedItemId'),
      input.executionEventId == null ? null : id(input.executionEventId, 'executionEventId'));
  }

  async addObservation(experimentId: string, variantId: string, outcomeId: string) {
    const normalizedExperiment = id(experimentId, 'experimentId'); const normalizedOutcome = id(outcomeId, 'outcomeId');
    const lockKey = `${normalizedExperiment}:${normalizedOutcome}`; const previous = this.observationLocks.get(lockKey) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const experiment = await this.get(normalizedExperiment);
      if (!['RUNNING', 'WAITING_FOR_DATA'].includes(experiment.status)) throw new ExperimentConflictError('experiment must be running to receive observations');
      const variant = experiment.variants.find(({ id: value }) => value === id(variantId, 'variantId'));
      if (!variant) throw new ExperimentationValidationError('variant does not belong to experiment');
      const outcome = await this.observations.findOutcome(normalizedOutcome);
      if (!outcome) throw new ExperimentObservationNotFoundError();
      if (experiment.projectId !== null && outcome.projectId !== experiment.projectId) throw new ExperimentConflictError('outcome belongs to another project');
      const benchmark = object(outcome.benchmark);
      try { return await this.observations.add({ experimentId: experiment.id, variantId: variant.id, outcomeId: outcome.id,
        observedAt: outcome.observedAt, freshness: outcome.freshness, dataQuality: outcome.dataQuality,
        comparisonContext: { format: benchmark.format ?? outcome.snapshot.format ?? null, windowHours: benchmark.windowHours ?? null,
          publicationAgeDays: benchmark.publicationAgeDays ?? null, strategy: benchmark.strategy ?? null }, metrics: outcome.metrics }); }
      catch (error) {
        if (!isUnique(error)) throw error;
        const existing = (await this.observations.findByExperiment(experiment.id)).find(({ outcomeId: value }) => value === outcome.id);
        if (!existing) throw error; return { observation: existing, created: false };
      }
    });
    this.observationLocks.set(lockKey, operation);
    try { return await operation; } finally { if (this.observationLocks.get(lockKey) === operation) this.observationLocks.delete(lockKey); }
  }

  async analyze(experimentId: string) {
    const normalized = id(experimentId, 'experimentId'); const previous = this.analysisLocks.get(normalized) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const experiment = await this.get(normalized);
      if (experiment.status === 'CANCELLED') throw new ExperimentConflictError('cancelled experiment cannot be analyzed');
      const primary = experiment.metrics.find(({ role }) => role === 'PRIMARY');
      if (!primary || !experiment.hypothesis) throw new ExperimentNotReadyError('experiment definition is incomplete');
      const analysis = analyzeStrategicExperiment({ experimentId: experiment.id, hypothesis: experiment.hypothesis.description,
        expectedVariantKey: experiment.hypothesis.expectedVariantKey, primaryMetric: primary.name as ExperimentMetricName,
        direction: primary.direction as ExperimentMetricDirection, variants: experiment.variants.map(({ key, label }) => ({ key, label })),
        observations: experiment.observations.map((entry) => ({ id: entry.id, variantKey: entry.variant.key,
          outcomeId: entry.outcomeId, videoId: entry.outcome.videoId, observedAt: entry.observedAt,
          freshness: entry.freshness, dataQuality: entry.dataQuality, comparisonContext: object(entry.comparisonContext),
          metrics: object(entry.metrics), outcomeConfidence: entry.outcome.confidence })) });
      const saved = await this.experiments.saveAnalysis(experiment.id, analysis, this.clock());
      if (saved.changed && analysis.classification !== 'INSUFFICIENT_EVIDENCE') {
        try {
          await this.learnings.refresh(experiment.projectId);
          for (const observation of experiment.observations) {
            const related = await this.learnings.related('outcomeId', observation.outcomeId);
            if (related[0]) await this.experiments.attachLearningForOutcome(experiment.id, observation.outcomeId, related[0].id);
          }
        } catch {
          // Experiment persistence is authoritative; learning refresh can be retried independently.
        }
      }
      return { ...saved, analysis };
    });
    this.analysisLocks.set(normalized, operation);
    try { return await operation; } finally { if (this.analysisLocks.get(normalized) === operation) this.analysisLocks.delete(normalized); }
  }

  async evidence(experimentId: string) { const experiment = await this.get(experimentId); return this.experiments.evidence(experiment.id); }
  async history(experimentId: string) { const experiment = await this.get(experimentId); return this.experiments.history(experiment.id); }
  async getOperationalSummary(projectId?: string | null) {
    const experiments = await this.list({ ...(projectId !== undefined ? { projectId } : {}), limit: 100 });
    return { total: experiments.length, active: experiments.filter(({ status }) => ['READY', 'RUNNING', 'WAITING_FOR_DATA'].includes(status)).length,
      waitingForData: experiments.filter(({ status }) => status === 'WAITING_FOR_DATA').length,
      stale: experiments.filter((entry) => Array.isArray(entry.result?.limitations) && entry.result.limitations.some((value) => typeof value === 'string' && /stale/i.test(value))).length,
      lowConfidence: experiments.filter(({ result }) => result && result.confidence < 0.5).length,
      inconclusive: experiments.filter(({ status }) => status === 'INCONCLUSIVE').length,
      contradicted: experiments.filter(({ result }) => result?.classification === 'CONTRADICTS_HYPOTHESIS').length };
  }

  async listForPlanner(projectId: string | null, limit = 5) {
    const experiments = await this.experiments.findAll({ projectId, limit: Math.min(10, limit) });
    return experiments.filter(({ status }) => ['READY', 'RUNNING', 'WAITING_FOR_DATA'].includes(status)).slice(0, limit)
      .map(({ id: experimentId, title, status, hypothesis, primaryMetric, result }) => ({ id: experimentId, title, status,
        hypothesis: hypothesis?.description ?? '', primaryMetric, result: result?.classification ?? null, confidence: result?.confidence ?? 0 }));
  }
}
