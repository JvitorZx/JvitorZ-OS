import { Router, type Response } from 'express';
import type { ManagerQueryInput } from '../domains/orchestration';
import { ManagerOrchestratorService } from '../services/orchestration/ManagerOrchestratorService';
import {
  OrchestrationNotFoundError,
  OrchestrationValidationError,
} from '../services/orchestration/OrchestratorService';
import {
  PlanReviewConflictError,
  PlanReviewRequiredError,
} from '../services/orchestration/PlanReviewService';

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const hasOnly = (value: Record<string, unknown>, fields: string[]) =>
  Object.keys(value).every((field) => fields.includes(field));
const optionalString = (value: unknown) => value === undefined || value === null || typeof value === 'string';

const validQueryBody = (body: unknown): body is ManagerQueryInput => isObject(body)
  && hasOnly(body, ['message', 'projectId', 'conversationId', 'requestId'])
  && typeof body.message === 'string'
  && optionalString(body.projectId)
  && optionalString(body.conversationId)
  && optionalString(body.requestId);

const sendError = (res: Response, error: unknown) => {
  if (error instanceof OrchestrationValidationError) return res.status(400).json({ error: error.message });
  if (error instanceof OrchestrationNotFoundError) return res.status(404).json({ error: error.message });
  if (error instanceof PlanReviewConflictError || error instanceof PlanReviewRequiredError) {
    return res.status(409).json({ error: error.message });
  }
  const name = error instanceof Error ? error.name : 'UnknownError';
  console.error(`Manager orchestration failed (${name})`);
  return res.status(500).json({ error: 'Manager orchestration failed' });
};

export const createManagerRouter = (
  service: ManagerOrchestratorService = new ManagerOrchestratorService(),
): Router => {
  const router = Router();

  router.post('/query', async (req, res) => {
    if (!validQueryBody(req.body)) return res.status(400).json({ error: 'invalid manager query payload' });
    try {
      return res.status(200).json(await service.query(req.body));
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/history', async (req, res) => {
    const { projectId, conversationId, limit } = req.query;
    if ((projectId !== undefined && typeof projectId !== 'string')
      || (conversationId !== undefined && typeof conversationId !== 'string')
      || (limit !== undefined && (typeof limit !== 'string' || !/^\d+$/.test(limit)))) {
      return res.status(400).json({ error: 'invalid manager history query' });
    }
    try {
      return res.status(200).json(await service.listHistory({
        projectId,
        conversationId,
        limit: limit === undefined ? undefined : Number(limit),
      }));
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/history/:id/diagnostics', async (req, res) => {
    try {
      return res.status(200).json(await service.getDiagnostics(req.params.id));
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/history/:id', async (req, res) => {
    try {
      return res.status(200).json(await service.getHistory(req.params.id));
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
};

export default createManagerRouter();
