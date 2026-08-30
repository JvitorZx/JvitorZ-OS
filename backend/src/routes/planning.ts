import { Router } from 'express';
import {
  ContentPlanNotFoundError,
  PlannedContentItemNotFoundError,
  StrategicPlanningService,
  StrategicPlanningValidationError,
} from '../services/strategic-planning';
import type { PlanningConstraint } from '../domains/strategic-planning';

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
  const name = error instanceof Error ? error.name : 'UnknownError';
  console.error(`Strategic planning request failed (${name})`);
  return res.status(500).json({ error: 'Strategic planning request failed' });
};

export const createPlanningRouter = (
  service: StrategicPlanningService = new StrategicPlanningService(),
): Router => {
  const router = Router();

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

  router.get('/:id', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id || Object.keys(req.query).length > 0) return res.status(400).json({ error: 'invalid plan id' });
    try { return res.status(200).json(await service.getById(id)); }
    catch (error) { return sendError(res, error); }
  });

  return router;
};

export default createPlanningRouter();
