import { Router } from 'express';
import {
  OrchestrationConfirmationRequiredError,
  OrchestrationNotFoundError,
  OrchestrationValidationError,
  OrchestratorService,
} from '../services/orchestration/OrchestratorService';

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const hasOnly = (value: Record<string, unknown>, fields: string[]) =>
  Object.keys(value).every((field) => fields.includes(field));
const optionalString = (value: unknown) => value === undefined || value === null || typeof value === 'string';

const validRequestBody = (body: unknown): body is Record<string, unknown> => {
  if (!isObject(body) || !hasOnly(body, [
    'intent', 'projectId', 'conversationId', 'idempotencyKey',
    'confirmExternalSideEffect', 'sync',
  ])) return false;
  if (typeof body.intent !== 'string'
    || !optionalString(body.projectId)
    || !optionalString(body.conversationId)
    || !optionalString(body.idempotencyKey)
    || (body.confirmExternalSideEffect !== undefined && typeof body.confirmExternalSideEffect !== 'boolean')) return false;
  if (body.sync !== undefined) {
    if (!isObject(body.sync) || !hasOnly(body.sync, ['mode', 'startDate', 'endDate', 'videoId', 'limit'])) return false;
    if (typeof body.sync.mode !== 'string'
      || typeof body.sync.startDate !== 'string'
      || typeof body.sync.endDate !== 'string'
      || !optionalString(body.sync.videoId)
      || (body.sync.limit !== undefined && typeof body.sync.limit !== 'number')) return false;
  }
  return true;
};

const mapError = (error: unknown) => {
  if (error instanceof OrchestrationValidationError) return { status: 400, error: error.message };
  if (error instanceof OrchestrationNotFoundError) return { status: 404, error: error.message };
  if (error instanceof OrchestrationConfirmationRequiredError) return { status: 409, error: error.message };
  const name = error instanceof Error ? error.name : 'UnknownError';
  console.error(`Orchestration operation failed (${name})`);
  return { status: 500, error: 'Orchestration operation failed' };
};

export const createOrchestratorRouter = (
  service: OrchestratorService = new OrchestratorService(),
): Router => {
  const router = Router();

  router.get('/capabilities', (_req, res) => res.status(200).json(service.listCapabilities()));

  router.post('/plan', (req, res) => {
    if (!validRequestBody(req.body)) return res.status(400).json({ error: 'invalid orchestration payload' });
    try {
      return res.status(200).json(service.plan(req.body as any));
    } catch (error) {
      const mapped = mapError(error);
      return res.status(mapped.status).json({ error: mapped.error });
    }
  });

  router.post('/run', async (req, res) => {
    if (!validRequestBody(req.body)) return res.status(400).json({ error: 'invalid orchestration payload' });
    try {
      const result = await service.run(req.body as any);
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      const mapped = mapError(error);
      return res.status(mapped.status).json({ error: mapped.error });
    }
  });

  router.get('/executions/recent', async (req, res) => {
    const { projectId, conversationId, limit } = req.query;
    if ((projectId !== undefined && typeof projectId !== 'string')
      || (conversationId !== undefined && typeof conversationId !== 'string')
      || (limit !== undefined && (typeof limit !== 'string' || !/^\d+$/.test(limit)))) {
      return res.status(400).json({ error: 'invalid orchestration query' });
    }
    try {
      return res.status(200).json(await service.listRecent({
        projectId,
        conversationId,
        limit: limit === undefined ? undefined : Number(limit),
      }));
    } catch (error) {
      const mapped = mapError(error);
      return res.status(mapped.status).json({ error: mapped.error });
    }
  });

  router.get('/executions/:id/plan', async (req, res) => {
    try {
      return res.status(200).json(await service.getExecutionPlan(req.params.id));
    } catch (error) {
      const mapped = mapError(error);
      return res.status(mapped.status).json({ error: mapped.error });
    }
  });

  router.get('/executions/:id', async (req, res) => {
    try {
      return res.status(200).json(await service.getExecution(req.params.id));
    } catch (error) {
      const mapped = mapError(error);
      return res.status(mapped.status).json({ error: mapped.error });
    }
  });

  return router;
};

export default createOrchestratorRouter();
