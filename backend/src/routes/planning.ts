import { Router } from 'express';
import {
  ContentPlanNotFoundError,
  PlanningExecutionConflictError,
  PlannedContentItemNotFoundError,
  StrategicPlanningService,
  StrategicPlanningValidationError,
  StrategicOutcomeConflictError,
  StrategicOutcomeItemNotFoundError,
  StrategicOutcomeNotFoundError,
  StrategicOutcomeNotReadyError,
  StrategicOutcomeService,
  StrategicOutcomeSnapshotNotFoundError,
  StrategicOutcomeValidationError,
} from '../services/strategic-planning';
import {
  StrategicLearningNotFoundError,
  StrategicLearningService,
  StrategicLearningValidationError,
} from '../services/strategic-learning';
import type { PlanningConstraint } from '../domains/strategic-planning';
import {
  ExperimentationService,
  ExperimentationValidationError,
  ExperimentNotFoundError,
  ExperimentObservationNotFoundError,
  ExperimentConflictError,
  ExperimentNotReadyError,
} from '../services/strategic-experimentation';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnly = (value: Record<string, unknown>, fields: readonly string[]): boolean =>
  Object.keys(value).every((field) => fields.includes(field));
const optionalText = (value: unknown): value is string | null | undefined =>
  value === undefined || value === null || typeof value === 'string';
const validConstraints = (value: unknown): value is PlanningConstraint[] =>
  value === undefined || (Array.isArray(value) && value.every((item) => isObject(item)
    && hasOnly(item, ['code', 'summary', 'blocking'])
    && typeof item.code === 'string'
    && typeof item.summary === 'string'
    && typeof item.blocking === 'boolean'));

const sendError = (res: Parameters<Parameters<Router['get']>[1]>[1], error: unknown) => {
  if (error instanceof StrategicPlanningValidationError) return res.status(400).json({ error: error.message });
  if (error instanceof ContentPlanNotFoundError || error instanceof PlannedContentItemNotFoundError) {
    return res.status(404).json({ error: error.message });
  }
  if (error instanceof PlanningExecutionConflictError) return res.status(409).json({ error: error.message });
  if (error instanceof StrategicOutcomeValidationError) return res.status(400).json({ error: error.message });
  if (error instanceof StrategicOutcomeItemNotFoundError
    || error instanceof StrategicOutcomeSnapshotNotFoundError
    || error instanceof StrategicOutcomeNotFoundError) return res.status(404).json({ error: error.message });
  if (error instanceof StrategicOutcomeConflictError) return res.status(409).json({ error: error.message });
  if (error instanceof StrategicOutcomeNotReadyError) return res.status(422).json({ error: error.message });
  if (error instanceof StrategicLearningValidationError) return res.status(400).json({ error: error.message });
  if (error instanceof StrategicLearningNotFoundError) return res.status(404).json({ error: error.message });
  if (error instanceof ExperimentationValidationError) return res.status(400).json({ error: error.message });
  if (error instanceof ExperimentNotFoundError || error instanceof ExperimentObservationNotFoundError) return res.status(404).json({ error: error.message });
  if (error instanceof ExperimentConflictError) return res.status(409).json({ error: error.message });
  if (error instanceof ExperimentNotReadyError) return res.status(422).json({ error: error.message });
  const name = error instanceof Error ? error.name : 'UnknownError';
  console.error(`Strategic planning request failed (${name})`);
  return res.status(500).json({ error: 'Strategic planning request failed' });
};

export const createPlanningRouter = (
  service: StrategicPlanningService = new StrategicPlanningService(),
  outcomeService: StrategicOutcomeService = new StrategicOutcomeService(),
  learningService: StrategicLearningService = new StrategicLearningService(),
  experimentationService: ExperimentationService = new ExperimentationService(),
): Router => {
  const router = Router();

  router.get('/current/guidance', async (req, res) => {
    if (!hasOnly(req.query as Record<string, unknown>, ['projectId', 'horizon'])
      || !optionalText(req.query.projectId) || !optionalText(req.query.horizon)) {
      return res.status(400).json({ error: 'invalid planning query' });
    }
    try {
      const guidance = await service.getCurrentGuidance({
        ...('projectId' in req.query ? { projectId: req.query.projectId || null } : {}),
        ...(req.query.horizon ? { horizon: req.query.horizon as never } : {}),
      });
      return guidance ? res.status(200).json(guidance) : res.status(404).json({ error: 'Content plan not found' });
    } catch (error) { return sendError(res, error); }
  });

  router.get('/current', async (req, res) => {
    if (!hasOnly(req.query as Record<string, unknown>, ['projectId', 'horizon'])
      || !optionalText(req.query.projectId) || !optionalText(req.query.horizon)) {
      return res.status(400).json({ error: 'invalid planning query' });
    }
    try {
      const plan = await service.getCurrent({
        ...('projectId' in req.query ? { projectId: req.query.projectId || null } : {}),
        ...(req.query.horizon ? { horizon: req.query.horizon as never } : {}),
      });
      return plan ? res.status(200).json(plan) : res.status(404).json({ error: 'Content plan not found' });
    } catch (error) { return sendError(res, error); }
  });

  router.post('/generate', async (req, res) => {
    if (!isObject(req.body) || !hasOnly(req.body, ['projectId', 'horizon', 'constraints'])
      || !optionalText(req.body.projectId) || !optionalText(req.body.horizon)
      || !validConstraints(req.body.constraints)) {
      return res.status(400).json({ error: 'invalid planning payload' });
    }
    try {
      const plan = await service.generate({
        projectId: req.body.projectId || null,
        ...(req.body.horizon ? { horizon: req.body.horizon as never } : {}),
        ...(req.body.constraints ? { constraints: req.body.constraints } : {}),
      });
      return res.status(201).json(plan);
    } catch (error) { return sendError(res, error); }
  });

  router.post('/items', async (req, res) => {
    if (!isObject(req.body) || !hasOnly(req.body, ['planId', 'title', 'candidateType', 'priority', 'effort', 'constraints', 'reason'])
      || typeof req.body.planId !== 'string' || typeof req.body.title !== 'string'
      || typeof req.body.reason !== 'string' || !optionalText(req.body.candidateType)
      || !optionalText(req.body.priority) || !optionalText(req.body.effort)
      || !validConstraints(req.body.constraints)) {
      return res.status(400).json({ error: 'invalid planning item payload' });
    }
    try {
      const item = await service.createItem({
        planId: req.body.planId, title: req.body.title, reason: req.body.reason,
        ...(req.body.candidateType ? { candidateType: req.body.candidateType } : {}),
        ...(req.body.priority ? { priority: req.body.priority as never } : {}),
        ...(req.body.effort ? { effort: req.body.effort as never } : {}),
        ...(req.body.constraints ? { constraints: req.body.constraints } : {}),
      });
      return res.status(201).json(item);
    } catch (error) { return sendError(res, error); }
  });

  router.patch('/items/:id', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id || !isObject(req.body) || !hasOnly(req.body, ['status', 'priority', 'effort', 'reason', 'requestResearch'])) {
      return res.status(400).json({ error: 'invalid planning item payload' });
    }
    if (req.body.requestResearch === true) {
      if (Object.keys(req.body).length !== 1) return res.status(400).json({ error: 'research request cannot contain other fields' });
      try { return res.status(200).json(await service.requestResearch(id)); }
      catch (error) { return sendError(res, error); }
    }
    if (typeof req.body.reason !== 'string'
      || !optionalText(req.body.status) || !optionalText(req.body.priority) || !optionalText(req.body.effort)
      || !['status', 'priority', 'effort'].some((field) => req.body[field] !== undefined)) {
      return res.status(400).json({ error: 'invalid planning item update' });
    }
    try {
      return res.status(200).json(await service.updateItem(id, {
        reason: req.body.reason,
        ...(req.body.status ? { status: req.body.status as never } : {}),
        ...(req.body.priority ? { priority: req.body.priority as never } : {}),
        ...(req.body.effort ? { effort: req.body.effort as never } : {}),
      }));
    } catch (error) { return sendError(res, error); }
  });

  router.post('/items/:id/complete', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id || !isObject(req.body) || !hasOnly(req.body, ['reason']) || !optionalText(req.body.reason)) {
      return res.status(400).json({ error: 'invalid completion payload' });
    }
    try { return res.status(200).json(await service.completeItem(id, req.body.reason || undefined)); }
    catch (error) { return sendError(res, error); }
  });

  router.post('/items/:id/execution', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id || !isObject(req.body) || !hasOnly(req.body, ['state', 'reason', 'note'])
      || typeof req.body.state !== 'string'
      || (req.body.reason !== undefined && typeof req.body.reason !== 'string')
      || (req.body.note !== undefined && typeof req.body.note !== 'string')) {
      return res.status(400).json({ error: 'invalid planning execution payload' });
    }
    try {
      return res.status(200).json(await service.transitionExecution(id, {
        state: req.body.state as never,
        ...(req.body.reason !== undefined ? { reason: req.body.reason } : {}),
        ...(req.body.note !== undefined ? { note: req.body.note } : {}),
      }));
    } catch (error) { return sendError(res, error); }
  });

  router.post('/reorder', async (req, res) => {
    if (!isObject(req.body) || !hasOnly(req.body, ['planId', 'itemIds', 'reason'])
      || typeof req.body.planId !== 'string' || typeof req.body.reason !== 'string'
      || !Array.isArray(req.body.itemIds) || !req.body.itemIds.every((id) => typeof id === 'string')) {
      return res.status(400).json({ error: 'invalid reorder payload' });
    }
    try { return res.status(200).json(await service.reorder(req.body.planId, req.body.itemIds, req.body.reason)); }
    catch (error) { return sendError(res, error); }
  });

  router.get('/history', async (req, res) => {
    if (!hasOnly(req.query as Record<string, unknown>, ['planId', 'itemId', 'limit'])
      || !optionalText(req.query.planId) || !optionalText(req.query.itemId)
      || (req.query.limit !== undefined && (typeof req.query.limit !== 'string' || !/^\d+$/.test(req.query.limit)))) {
      return res.status(400).json({ error: 'invalid planning history query' });
    }
    try {
      return res.status(200).json(await service.listHistory({
        ...(req.query.planId ? { planId: req.query.planId } : {}),
        ...(req.query.itemId ? { itemId: req.query.itemId } : {}),
        ...(req.query.limit ? { limit: Number(req.query.limit) } : {}),
      }));
    } catch (error) { return sendError(res, error); }
  });

  router.get('/execution-history', async (req, res) => {
    if (!hasOnly(req.query as Record<string, unknown>, ['planId', 'itemId', 'limit'])
      || !optionalText(req.query.planId) || !optionalText(req.query.itemId)
      || (req.query.limit !== undefined && (typeof req.query.limit !== 'string' || !/^\d+$/.test(req.query.limit)))) {
      return res.status(400).json({ error: 'invalid planning execution history query' });
    }
    try {
      return res.status(200).json(await service.listExecutionHistory({
        ...(req.query.planId ? { planId: req.query.planId } : {}),
        ...(req.query.itemId ? { itemId: req.query.itemId } : {}),
        ...(req.query.limit ? { limit: Number(req.query.limit) } : {}),
      }));
    } catch (error) { return sendError(res, error); }
  });

  router.get('/items/:id/video-candidates', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id || Object.keys(req.query).length > 0) return res.status(400).json({ error: 'invalid planning item id' });
    try { return res.status(200).json(await outcomeService.listVideoCandidates(id)); }
    catch (error) { return sendError(res, error); }
  });

  router.get('/items/:id/outcome', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id || Object.keys(req.query).length > 0) return res.status(400).json({ error: 'invalid planning item id' });
    try { return res.status(200).json(await outcomeService.getItemOutcome(id)); }
    catch (error) { return sendError(res, error); }
  });

  router.post('/items/:id/outcome/video', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id || !isObject(req.body) || !hasOnly(req.body, ['snapshotId', 'reason'])
      || typeof req.body.snapshotId !== 'string' || !optionalText(req.body.reason)) {
      return res.status(400).json({ error: 'invalid planning video link payload' });
    }
    try {
      const result = await outcomeService.associateVideo(id, { snapshotId: req.body.snapshotId, reason: req.body.reason });
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) { return sendError(res, error); }
  });

  router.delete('/items/:id/outcome/video', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id || !isObject(req.body) || !hasOnly(req.body, ['reason']) || typeof req.body.reason !== 'string') {
      return res.status(400).json({ error: 'invalid planning video unlink payload' });
    }
    try { return res.status(200).json(await outcomeService.unlinkVideo(id, req.body.reason)); }
    catch (error) { return sendError(res, error); }
  });

  router.post('/items/:id/outcomes', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id || !isObject(req.body) || !hasOnly(req.body, ['snapshotId']) || !optionalText(req.body.snapshotId)) {
      return res.status(400).json({ error: 'invalid planning outcome payload' });
    }
    try {
      const result = await outcomeService.captureOutcome(id, req.body.snapshotId);
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) { return sendError(res, error); }
  });

  router.get('/outcomes/:id', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id || Object.keys(req.query).length > 0) return res.status(400).json({ error: 'invalid planning outcome id' });
    try { return res.status(200).json(await outcomeService.getOutcome(id)); }
    catch (error) { return sendError(res, error); }
  });

  router.get('/learnings', async (req, res) => {
    if (!hasOnly(req.query as Record<string, unknown>, ['projectId', 'status', 'dimension', 'limit'])
      || !optionalText(req.query.projectId) || !optionalText(req.query.status) || !optionalText(req.query.dimension)
      || (req.query.limit !== undefined && (typeof req.query.limit !== 'string' || !/^\d+$/.test(req.query.limit)))) {
      return res.status(400).json({ error: 'invalid strategic learning query' });
    }
    try { return res.status(200).json(await learningService.list({
      ...('projectId' in req.query ? { projectId: req.query.projectId || null } : {}),
      ...(req.query.status ? { status: req.query.status } : {}),
      ...(req.query.dimension ? { dimension: req.query.dimension } : {}),
      ...(req.query.limit ? { limit: Number(req.query.limit) } : {}),
    })); } catch (error) { return sendError(res, error); }
  });

  router.post('/learnings/refresh', async (req, res) => {
    if (!isObject(req.body) || !hasOnly(req.body, ['projectId']) || !optionalText(req.body.projectId)) {
      return res.status(400).json({ error: 'invalid strategic learning refresh payload' });
    }
    try { return res.status(200).json(await learningService.refresh('projectId' in req.body ? req.body.projectId || null : undefined)); }
    catch (error) { return sendError(res, error); }
  });

  router.get('/learnings/:id/evidence', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id || Object.keys(req.query).length) return res.status(400).json({ error: 'invalid strategic learning id' });
    try { return res.status(200).json(await learningService.evidence(id)); } catch (error) { return sendError(res, error); }
  });

  router.get('/learnings/:id/history', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id || Object.keys(req.query).length) return res.status(400).json({ error: 'invalid strategic learning id' });
    try { return res.status(200).json(await learningService.history(id)); } catch (error) { return sendError(res, error); }
  });

  router.get('/learnings/:id', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id || Object.keys(req.query).length) return res.status(400).json({ error: 'invalid strategic learning id' });
    try { return res.status(200).json(await learningService.get(id)); } catch (error) { return sendError(res, error); }
  });

  const related = (kind: 'itemId' | 'planId' | 'outcomeId' | 'videoId') => async (req: Parameters<Parameters<Router['get']>[1]>[0], res: Parameters<Parameters<Router['get']>[1]>[1]) => {
    const id = req.params.id?.trim();
    if (!id || Object.keys(req.query).length) return res.status(400).json({ error: 'invalid strategic learning relation id' });
    try { return res.status(200).json(await learningService.related(kind, id)); } catch (error) { return sendError(res, error); }
  };
  router.get('/items/:id/learnings', related('itemId'));
  router.get('/plans/:id/learnings', related('planId'));
  router.get('/outcomes/:id/learnings', related('outcomeId'));
  router.get('/videos/:id/learnings', related('videoId'));

  router.get('/experiments', async (req, res) => {
    if (!hasOnly(req.query as Record<string, unknown>, ['projectId', 'status', 'limit'])
      || !optionalText(req.query.projectId) || !optionalText(req.query.status)
      || (req.query.limit !== undefined && (typeof req.query.limit !== 'string' || !/^\d+$/.test(req.query.limit)))) {
      return res.status(400).json({ error: 'invalid experiment query' });
    }
    try { return res.status(200).json(await experimentationService.list({
      ...('projectId' in req.query ? { projectId: req.query.projectId || null } : {}),
      ...(req.query.status ? { status: req.query.status } : {}), ...(req.query.limit ? { limit: Number(req.query.limit) } : {}),
    })); } catch (error) { return sendError(res, error); }
  });

  router.post('/experiments', async (req, res) => {
    const fields = ['projectId', 'sourceLearningId', 'title', 'description', 'context', 'hypothesis', 'priorEvidence',
      'expectedVariantKey', 'primaryMetric', 'secondaryMetrics', 'metricDirection', 'risk', 'comparisonCriterion', 'variants', 'constraints'];
    if (!isObject(req.body) || !hasOnly(req.body, fields) || !Array.isArray(req.body.variants)) {
      return res.status(400).json({ error: 'invalid experiment payload' });
    }
    try { return res.status(201).json(await experimentationService.create(req.body as never)); }
    catch (error) { return sendError(res, error); }
  });

  router.get('/experiments/:id/evidence', async (req, res) => {
    const id = req.params.id?.trim(); if (!id || Object.keys(req.query).length) return res.status(400).json({ error: 'invalid experiment id' });
    try { return res.status(200).json(await experimentationService.evidence(id)); } catch (error) { return sendError(res, error); }
  });
  router.get('/experiments/:id/history', async (req, res) => {
    const id = req.params.id?.trim(); if (!id || Object.keys(req.query).length) return res.status(400).json({ error: 'invalid experiment id' });
    try { return res.status(200).json(await experimentationService.history(id)); } catch (error) { return sendError(res, error); }
  });
  router.get('/experiments/:id', async (req, res) => {
    const id = req.params.id?.trim(); if (!id || Object.keys(req.query).length) return res.status(400).json({ error: 'invalid experiment id' });
    try { return res.status(200).json(await experimentationService.get(id)); } catch (error) { return sendError(res, error); }
  });
  router.post('/experiments/:id/start', async (req, res) => {
    const id = req.params.id?.trim(); if (!id || !isObject(req.body) || !hasOnly(req.body, [])) return res.status(400).json({ error: 'invalid experiment start payload' });
    try { return res.status(200).json(await experimentationService.start(id)); } catch (error) { return sendError(res, error); }
  });
  router.post('/experiments/:id/cancel', async (req, res) => {
    const id = req.params.id?.trim(); if (!id || !isObject(req.body) || !hasOnly(req.body, ['reason']) || !optionalText(req.body.reason)) return res.status(400).json({ error: 'invalid experiment cancel payload' });
    try { return res.status(200).json(await experimentationService.cancel(id, req.body.reason as string | null | undefined)); } catch (error) { return sendError(res, error); }
  });
  router.patch('/experiments/:id/variants/:variantId', async (req, res) => {
    const id = req.params.id?.trim(); const variantId = req.params.variantId?.trim();
    if (!id || !variantId || !isObject(req.body) || !hasOnly(req.body, ['plannedItemId', 'executionEventId'])
      || !optionalText(req.body.plannedItemId) || !optionalText(req.body.executionEventId)) return res.status(400).json({ error: 'invalid experiment variant payload' });
    try { return res.status(200).json(await experimentationService.linkVariant(id, variantId, req.body as never)); } catch (error) { return sendError(res, error); }
  });
  router.post('/experiments/:id/observations', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id || !isObject(req.body) || !hasOnly(req.body, ['variantId', 'outcomeId'])
      || typeof req.body.variantId !== 'string' || typeof req.body.outcomeId !== 'string') return res.status(400).json({ error: 'invalid experiment observation payload' });
    try { const result = await experimentationService.addObservation(id, req.body.variantId, req.body.outcomeId); return res.status(result.created ? 201 : 200).json(result); }
    catch (error) { return sendError(res, error); }
  });
  router.post('/experiments/:id/analyze', async (req, res) => {
    const id = req.params.id?.trim(); if (!id || !isObject(req.body) || !hasOnly(req.body, [])) return res.status(400).json({ error: 'invalid experiment analysis payload' });
    try { return res.status(200).json(await experimentationService.analyze(id)); } catch (error) { return sendError(res, error); }
  });

  router.get('/:id', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id || Object.keys(req.query).length > 0) return res.status(400).json({ error: 'invalid plan id' });
    try { return res.status(200).json(await service.getById(id)); }
    catch (error) { return sendError(res, error); }
  });

  return router;
};

export default createPlanningRouter();
