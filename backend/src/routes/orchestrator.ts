import { Router, type Response } from 'express';
import {
  OrchestrationConfirmationRequiredError,
  OrchestrationNotFoundError,
  OrchestrationValidationError,
  OrchestratorService,
} from '../services/orchestration/OrchestratorService';
import type { OrchestrationRequest } from '../domains/orchestration';
import {
  PlanReviewConflictError,
  PlanReviewExpiredError,
  PlanReviewNotFoundError,
  PlanReviewRequiredError,
  PlanReviewValidationError,
} from '../services/orchestration/PlanReviewService';

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const hasOnly = (value: Record<string, unknown>, fields: string[]) =>
  Object.keys(value).every((field) => fields.includes(field));
const optionalString = (value: unknown) => value === undefined || value === null || typeof value === 'string';

const validRequestBody = (body: unknown): body is OrchestrationRequest => {
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
    if (!['video', 'recent', 'period'].includes(String(body.sync.mode))
      || typeof body.sync.startDate !== 'string'
      || typeof body.sync.endDate !== 'string'
      || !optionalString(body.sync.videoId)
      || (body.sync.limit !== undefined && (!Number.isInteger(body.sync.limit)
        || Number(body.sync.limit) < 1 || Number(body.sync.limit) > 50))) return false;
  }
  return true;
};

const mapError = (error: unknown) => {
  if (error instanceof OrchestrationValidationError) return { status: 400, error: error.message };
  if (error instanceof PlanReviewValidationError) return { status: 400, error: error.message };
  if (error instanceof OrchestrationNotFoundError || error instanceof PlanReviewNotFoundError) {
    return { status: 404, error: error.message };
  }
  if (error instanceof PlanReviewExpiredError) return { status: 410, error: error.message };
  if (error instanceof PlanReviewRequiredError) {
    return { status: 409, error: error.message, executionId: error.executionId };
  }
  if (error instanceof PlanReviewConflictError) return { status: 409, error: error.message };
  if (error instanceof OrchestrationConfirmationRequiredError) return { status: 409, error: error.message };
  const name = error instanceof Error ? error.name : 'UnknownError';
  console.error(`Orchestration operation failed (${name})`);
    return { status: 500, error: 'Orchestration operation failed' };
};

const sendMappedError = (res: Response, error: unknown) => {
  const mapped = mapError(error);
  return res.status(mapped.status).json({
    error: mapped.error,
    ...('executionId' in mapped ? { executionId: mapped.executionId } : {}),
  });
};

const validDecisionBody = (body: unknown, requireReason: boolean): body is {
  reviewer: string; reason?: string; expectedVersion: number;
} => isObject(body)
  && hasOnly(body, ['reviewer', 'reason', 'expectedVersion'])
  && typeof body.reviewer === 'string'
  && (!requireReason || typeof body.reason === 'string')
  && (body.reason === undefined || typeof body.reason === 'string')
  && Number.isInteger(body.expectedVersion)
  && Number(body.expectedVersion) > 0;

const validExpireBody = (body: unknown): body is { reason?: string } => isObject(body)
  && hasOnly(body, ['reason'])
  && (body.reason === undefined || typeof body.reason === 'string');

const emptyBody = (body: unknown): boolean => isObject(body) && Object.keys(body).length === 0;

export const createOrchestratorRouter = (
  service: OrchestratorService = new OrchestratorService(),
): Router => {
  const router = Router();

  router.get('/capabilities', (_req, res) => res.status(200).json(service.listCapabilities()));

  router.post('/plan', (req, res) => {
    if (!validRequestBody(req.body)) return res.status(400).json({ error: 'invalid orchestration payload' });
    try {
      return res.status(200).json(service.plan(req.body));
    } catch (error) {
      return sendMappedError(res, error);
    }
  });

  router.post('/preview', async (req, res) => {
    if (!validRequestBody(req.body)) return res.status(400).json({ error: 'invalid orchestration payload' });
    try {
      const preview = await service.preview(req.body);
      return res.status(preview.created ? 201 : 200).json(preview);
    } catch (error) {
      return sendMappedError(res, error);
    }
  });

  router.post('/run', async (req, res) => {
    if (!validRequestBody(req.body)) return res.status(400).json({ error: 'invalid orchestration payload' });
    try {
      const result = await service.run(req.body);
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      return sendMappedError(res, error);
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
      return sendMappedError(res, error);
    }
  });

  router.get('/executions/:id/review', async (req, res) => {
    try {
      return res.status(200).json(await service.getPlanReview(req.params.id));
    } catch (error) {
      return sendMappedError(res, error);
    }
  });

  router.post('/executions/:id/approve', async (req, res) => {
    if (!validDecisionBody(req.body, false)) return res.status(400).json({ error: 'invalid approval payload' });
    try {
      const approved = await service.approvePlan(
        req.params.id, req.body.reviewer, req.body.reason, req.body.expectedVersion,
      );
      return res.status(200).json(approved);
    } catch (error) {
      return sendMappedError(res, error);
    }
  });

  router.post('/executions/:id/reject', async (req, res) => {
    if (!validDecisionBody(req.body, true)) return res.status(400).json({ error: 'invalid rejection payload' });
    try {
      return res.status(200).json(await service.rejectPlan(
        req.params.id, req.body.reviewer, req.body.reason, req.body.expectedVersion,
      ));
    } catch (error) {
      return sendMappedError(res, error);
    }
  });

  router.post('/executions/:id/expire', async (req, res) => {
    if (!validExpireBody(req.body)) return res.status(400).json({ error: 'invalid expiration payload' });
    try {
      return res.status(200).json(await service.expirePlan(req.params.id, req.body.reason));
    } catch (error) {
      return sendMappedError(res, error);
    }
  });

  router.post('/executions/:id/execute', async (req, res) => {
    if (!emptyBody(req.body)) return res.status(400).json({ error: 'execution body must be empty' });
    try {
      const result = await service.executeApprovedPlan(req.params.id);
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      return sendMappedError(res, error);
    }
  });

  router.get('/executions/:id/audit', async (req, res) => {
    try {
      return res.status(200).json(await service.getAuditTrail(req.params.id));
    } catch (error) {
      return sendMappedError(res, error);
    }
  });

  router.get('/executions/:id/plan', async (req, res) => {
    try {
      return res.status(200).json(await service.getExecutionPlan(req.params.id));
    } catch (error) {
      return sendMappedError(res, error);
    }
  });

  router.get('/executions/:id', async (req, res) => {
    try {
      return res.status(200).json(await service.getExecution(req.params.id));
    } catch (error) {
      return sendMappedError(res, error);
    }
  });

  return router;
};

export default createOrchestratorRouter();
