import { Router } from 'express';
import { PackagingConflictError, PackagingNotFoundError, PackagingService, PackagingValidationError } from '../services/packaging';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const only = (value: Record<string, unknown>, fields: readonly string[]) => Object.keys(value).every((key) => fields.includes(key));
const GENERATE = ['projectId', 'contentKey', 'videoId', 'game', 'series', 'episode', 'format', 'summary', 'keyEvents', 'editorialObjective', 'constraints', 'variationCount'] as const;
const EDIT = ['title', 'thumbnailBrief', 'description', 'tags', 'reason'] as const;
const safeError = (res: Parameters<Parameters<Router['get']>[1]>[1], error: unknown) => {
  if (error instanceof PackagingValidationError) return res.status(400).json({ error: error.message });
  if (error instanceof PackagingNotFoundError) return res.status(404).json({ error: error.message });
  if (error instanceof PackagingConflictError) return res.status(409).json({ error: error.message });
  console.error(`Packaging request failed (${error instanceof Error ? error.name : 'UnknownError'})`);
  return res.status(500).json({ error: 'Packaging request failed' });
};

export const createPackagingRouter = (service: PackagingService = new PackagingService()): Router => {
  const router = Router();
  router.get('/', async (req, res) => {
    if (!only(req.query as Record<string, unknown>, ['projectId', 'game', 'series', 'status', 'limit'])) return res.status(400).json({ error: 'query is invalid' });
    try {
      const value = (key: string) => typeof req.query[key] === 'string' && req.query[key] ? String(req.query[key]) : undefined;
      const limitText = value('limit'); const limit = limitText === undefined ? undefined : Number(limitText);
      return res.status(200).json(await service.list({ ...('projectId' in req.query ? { projectId: value('projectId') ?? null } : {}),
        ...(value('game') ? { game: value('game') } : {}), ...(value('series') ? { series: value('series') } : {}), ...(value('status') ? { status: value('status') } : {}), ...(limit !== undefined ? { limit } : {}) }));
    } catch (error) { return safeError(res, error); }
  });
  router.post('/', async (req, res) => {
    if (!object(req.body) || !only(req.body, GENERATE)) return res.status(400).json({ error: 'payload is invalid' });
    try { return res.status(201).json(await service.generate(req.body as never)); } catch (error) { return safeError(res, error); }
  });
  router.patch('/variants/:id', async (req, res) => {
    if (!req.params.id?.trim() || !object(req.body) || !only(req.body, EDIT)) return res.status(400).json({ error: 'payload is invalid' });
    try { return res.status(200).json(await service.editVariant(req.params.id, req.body)); } catch (error) { return safeError(res, error); }
  });
  router.post('/variants/:id/select', async (req, res) => {
    if (!req.params.id?.trim() || !object(req.body) || !only(req.body, ['reason'])) return res.status(400).json({ error: 'payload is invalid' });
    try { return res.status(200).json(await service.selectVariant(req.params.id, req.body.reason)); } catch (error) { return safeError(res, error); }
  });
  router.post('/variants/:id/reject', async (req, res) => {
    if (!req.params.id?.trim() || !object(req.body) || !only(req.body, ['reason'])) return res.status(400).json({ error: 'payload is invalid' });
    try { return res.status(200).json(await service.rejectVariant(req.params.id, req.body.reason)); } catch (error) { return safeError(res, error); }
  });
  router.post('/variants/:id/publish', async (req, res) => {
    if (!req.params.id?.trim() || !object(req.body) || !only(req.body, ['videoId', 'publishedAt'])) return res.status(400).json({ error: 'payload is invalid' });
    try { return res.status(200).json(await service.publishVariant(req.params.id, req.body as never)); } catch (error) { return safeError(res, error); }
  });
  router.post('/variants/:id/observe', async (req, res) => {
    if (!req.params.id?.trim() || !object(req.body) || Object.keys(req.body).length) return res.status(400).json({ error: 'payload is invalid' });
    try { return res.status(200).json(await service.observeVariant(req.params.id)); } catch (error) { return safeError(res, error); }
  });
  router.get('/variants/:id/review', async (req, res) => {
    if (!req.params.id?.trim() || Object.keys(req.query).length) return res.status(400).json({ error: 'id is invalid' });
    try { return res.status(200).json(await service.reviewVariant(req.params.id)); } catch (error) { return safeError(res, error); }
  });
  router.post('/:id/experiments', async (req, res) => {
    if (!req.params.id?.trim() || !object(req.body) || !only(req.body, ['hypothesis', 'variantIds'])) return res.status(400).json({ error: 'payload is invalid' });
    try { return res.status(201).json(await service.createExperiment(req.params.id, req.body as never)); } catch (error) { return safeError(res, error); }
  });
  router.post('/:id/learning', async (req, res) => {
    if (!req.params.id?.trim() || !object(req.body) || Object.keys(req.body).length) return res.status(400).json({ error: 'payload is invalid' });
    try { return res.status(201).json(await service.recordLearning(req.params.id)); } catch (error) { return safeError(res, error); }
  });
  router.get('/:id/history', async (req, res) => {
    if (!req.params.id?.trim() || Object.keys(req.query).length) return res.status(400).json({ error: 'id is invalid' });
    try { return res.status(200).json((await service.get(req.params.id)).history); } catch (error) { return safeError(res, error); }
  });
  router.get('/:id', async (req, res) => {
    if (!req.params.id?.trim() || Object.keys(req.query).length) return res.status(400).json({ error: 'id is invalid' });
    try { return res.status(200).json(await service.get(req.params.id)); } catch (error) { return safeError(res, error); }
  });
  return router;
};

export default createPackagingRouter();
