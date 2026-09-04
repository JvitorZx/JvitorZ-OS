import { Router } from 'express';
import { ProductionConflictError, ProductionNotFoundError, ProductionService, ProductionValidationError } from '../services/production';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const only = (value: Record<string, unknown>, fields: readonly string[]) => Object.keys(value).every((key) => fields.includes(key));
const CREATE = ['productionKey', 'projectId', 'title', 'format', 'game', 'series', 'episode', 'origin', 'objective', 'summary', 'keyEvents', 'owner', 'priority', 'plannedAt', 'videoIdeaId', 'plannedContentItemId', 'seriesId'] as const;
const UPDATE = ['title', 'game', 'series', 'objective', 'summary', 'keyEvents', 'owner', 'priority', 'plannedAt'] as const;
const ACTION = ['reason', 'operationKey'] as const;
const COMPLETE = ['reason', 'operationKey', 'output'] as const;

const safeError = (res: Parameters<Parameters<Router['get']>[1]>[1], error: unknown) => {
  if (error instanceof ProductionValidationError) return res.status(400).json({ error: error.message });
  if (error instanceof ProductionNotFoundError) return res.status(404).json({ error: error.message });
  if (error instanceof ProductionConflictError) return res.status(409).json({ error: error.message });
  console.error(`Production request failed (${error instanceof Error ? error.name : 'UnknownError'})`);
  return res.status(500).json({ error: 'Production request failed' });
};

export const createProductionRouter = (service: ProductionService = new ProductionService()): Router => {
  const router = Router();
  router.get('/', async (req, res) => {
    if (!only(req.query as Record<string, unknown>, ['projectId', 'status', 'format', 'limit'])) return res.status(400).json({ error: 'query is invalid' });
    try { const value = (key: string) => typeof req.query[key] === 'string' && req.query[key] ? String(req.query[key]) : undefined; const limitText = value('limit'); const limit = limitText == null ? undefined : Number(limitText); return res.status(200).json(await service.list({ ...('projectId' in req.query ? { projectId: value('projectId') ?? null } : {}), ...(value('status') ? { status: value('status') } : {}), ...(value('format') ? { format: value('format') } : {}), ...(limit !== undefined ? { limit } : {}) })); }
    catch (error) { return safeError(res, error); }
  });
  router.post('/', async (req, res) => { if (!object(req.body) || !only(req.body, CREATE)) return res.status(400).json({ error: 'payload is invalid' }); try { const result = await service.create(req.body); return res.status(result.created ? 201 : 200).json(result.production); } catch (error) { return safeError(res, error); } });
  router.get('/:id', async (req, res) => { try { return res.status(200).json(await service.get(req.params.id)); } catch (error) { return safeError(res, error); } });
  router.patch('/:id', async (req, res) => { if (!object(req.body) || !only(req.body, UPDATE)) return res.status(400).json({ error: 'payload is invalid' }); try { return res.status(200).json(await service.update(req.params.id, req.body)); } catch (error) { return safeError(res, error); } });
  router.get('/:id/workflow', async (req, res) => { try { const value = await service.resume(req.params.id); return res.status(200).json({ id: value.id, status: value.status, currentStage: value.currentStage, steps: value.steps, nextAction: value.nextAction }); } catch (error) { return safeError(res, error); } });
  router.get('/:id/next-action', async (req, res) => { try { return res.status(200).json(await service.nextAction(req.params.id)); } catch (error) { return safeError(res, error); } });
  router.get('/:id/history', async (req, res) => { try { return res.status(200).json((await service.get(req.params.id)).events); } catch (error) { return safeError(res, error); } });
  router.post('/:id/resume', async (req, res) => { if (!object(req.body) || Object.keys(req.body).length) return res.status(400).json({ error: 'payload is invalid' }); try { return res.status(200).json(await service.resume(req.params.id)); } catch (error) { return safeError(res, error); } });
  router.post('/:id/cancel', async (req, res) => { if (!object(req.body) || !only(req.body, ['reason']) || typeof req.body.reason !== 'string') return res.status(400).json({ error: 'payload is invalid' }); try { return res.status(200).json(await service.cancel(req.params.id, req.body.reason)); } catch (error) { return safeError(res, error); } });

  for (const [action, fields, invoke] of [
    ['start', ACTION, (id: string, key: string, body: Record<string, unknown>) => service.startStep(id, key, body)],
    ['complete', COMPLETE, (id: string, key: string, body: Record<string, unknown>) => service.completeStep(id, key, body)],
    ['skip', ACTION, (id: string, key: string, body: Record<string, unknown>) => service.skipStep(id, key, body)],
    ['retry', ACTION, (id: string, key: string, body: Record<string, unknown>) => service.retryStep(id, key, body)],
    ['repeat', ACTION, (id: string, key: string, body: Record<string, unknown>) => service.repeatStep(id, key, body)],
  ] as const) router.post(`/:id/steps/:stepKey/${action}`, async (req, res) => { if (!object(req.body) || !only(req.body, fields)) return res.status(400).json({ error: 'payload is invalid' }); try { return res.status(200).json(await invoke(req.params.id, req.params.stepKey, req.body)); } catch (error) { return safeError(res, error); } });

  router.post('/:id/packaging/run', async (req, res) => { if (!object(req.body) || Object.keys(req.body).length) return res.status(400).json({ error: 'payload is invalid' }); try { const result = await service.runPackaging(req.params.id); return res.status(result.created ? 201 : 200).json(result); } catch (error) { return safeError(res, error); } });
  router.post('/:id/packaging/link', async (req, res) => { if (!object(req.body) || !only(req.body, ['packagingId']) || typeof req.body.packagingId !== 'string') return res.status(400).json({ error: 'payload is invalid' }); try { return res.status(200).json(await service.linkPackaging(req.params.id, req.body.packagingId)); } catch (error) { return safeError(res, error); } });
  router.post('/:id/review', async (req, res) => { if (!object(req.body) || Object.keys(req.body).length) return res.status(400).json({ error: 'payload is invalid' }); try { return res.status(200).json(await service.review(req.params.id)); } catch (error) { return safeError(res, error); } });
  router.post('/:id/assets', async (req, res) => { if (!object(req.body) || !only(req.body, ['libraryItemId', 'role'])) return res.status(400).json({ error: 'payload is invalid' }); try { return res.status(201).json(await service.linkAsset(req.params.id, req.body.libraryItemId, req.body.role)); } catch (error) { return safeError(res, error); } });
  router.delete('/:id/assets/:relationId', async (req, res) => { try { return res.status(200).json(await service.unlinkAsset(req.params.id, req.params.relationId)); } catch (error) { return safeError(res, error); } });
  router.post('/:id/publication', async (req, res) => { if (!object(req.body) || !only(req.body, ['videoId', 'url', 'publishedAt'])) return res.status(400).json({ error: 'payload is invalid' }); try { return res.status(200).json(await service.publish(req.params.id, req.body)); } catch (error) { return safeError(res, error); } });
  return router;
};

export default createProductionRouter();
