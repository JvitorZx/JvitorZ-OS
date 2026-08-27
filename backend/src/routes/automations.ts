import { Router, type Response } from 'express';
import type { CreateAutomationInput, UpdateAutomationInput } from '../domains/automation';
import {
  AutomationConflictError,
  AutomationNotFoundError,
  AutomationRunnerService,
  AutomationRunNotFoundError,
  AutomationSchedulerService,
  AutomationService,
  AutomationValidationError,
} from '../services/automation';
import {
  AutomationRuntimeService,
  AutomationRuntimeDisabledError,
  AutomationRuntimeConflictError,
  automationRuntime,
} from '../services/automation/AutomationRuntimeService';
import { AutomationGovernanceService } from '../services/automation/AutomationGovernanceService';
import { AutomationDiagnosticsService } from '../services/automation/AutomationDiagnosticsService';
import { AutomationScheduleValidationError } from '../domains/automation';

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const hasOnly = (value: Record<string, unknown>, fields: string[]) => Object.keys(value).every((key) => fields.includes(key));
const validId = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 120;
const emptyBody = (value: unknown) => value === undefined || (isObject(value) && Object.keys(value).length === 0);
const validLimit = (value: unknown) => value === undefined || (typeof value === 'string' && /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 100);

const mapError = (error: unknown) => {
  if (error instanceof AutomationValidationError || error instanceof AutomationScheduleValidationError) {
    return { status: 400, error: error.message };
  }
  if (error instanceof AutomationNotFoundError || error instanceof AutomationRunNotFoundError) {
    return { status: 404, error: error.message };
  }
  if (error instanceof AutomationConflictError) return { status: 409, error: error.message };
  if (error instanceof AutomationRuntimeDisabledError || error instanceof AutomationRuntimeConflictError) {
    return { status: 409, error: error.message };
  }
  const name = error instanceof Error ? error.name : 'UnknownError';
  console.error(`Automation operation failed (${name})`);
  return { status: 500, error: 'Automation operation failed' };
};
const sendError = (res: Response, error: unknown) => {
  const mapped = mapError(error);
  return res.status(mapped.status).json({ error: mapped.error });
};

const validCreate = (body: unknown): body is CreateAutomationInput => isObject(body)
  && hasOnly(body, ['projectId', 'name', 'description', 'triggerType', 'schedule', 'timezone', 'intent', 'orchestrationInput', 'enabled'])
  && typeof body.name === 'string'
  && typeof body.triggerType === 'string'
  && typeof body.intent === 'string'
  && (body.enabled === undefined || typeof body.enabled === 'boolean');

const validUpdate = (body: unknown): body is UpdateAutomationInput => isObject(body)
  && Object.keys(body).length > 0
  && hasOnly(body, ['name', 'description', 'triggerType', 'schedule', 'timezone', 'intent', 'orchestrationInput']);

export const createAutomationsRouter = (
  service = new AutomationService(),
  runner = new AutomationRunnerService(),
  scheduler = new AutomationSchedulerService(),
  runtime: AutomationRuntimeService = automationRuntime,
  governance = new AutomationGovernanceService(),
  diagnostics = new AutomationDiagnosticsService(governance),
): Router => {
  const router = Router();

  router.get('/runtime/status', (_req, res) => res.status(200).json(runtime.getHealth()));
  router.get('/runtime/health', (_req, res) => res.status(200).json(runtime.getHealth()));
  router.get('/runtime/events', async (req, res) => {
    if (!validLimit(req.query.limit)) return res.status(400).json({ error: 'invalid runtime events query' });
    try { return res.status(200).json(await runtime.listEvents(req.query.limit ? Number(req.query.limit) : 100)); }
    catch (error) { return sendError(res, error); }
  });
  router.post('/runtime/start', async (req, res) => {
    if (!emptyBody(req.body)) return res.status(400).json({ error: 'runtime start body must be empty' });
    try { return res.status(200).json(await runtime.start()); } catch (error) { return sendError(res, error); }
  });
  router.post('/runtime/stop', async (req, res) => {
    if (!emptyBody(req.body)) return res.status(400).json({ error: 'runtime stop body must be empty' });
    try { return res.status(200).json(await runtime.stop()); } catch (error) { return sendError(res, error); }
  });
  router.post('/runtime/tick', async (req, res) => {
    if (!emptyBody(req.body)) return res.status(400).json({ error: 'runtime tick body must be empty' });
    try { return res.status(200).json(await runtime.triggerTick()); } catch (error) { return sendError(res, error); }
  });

  router.get('/diagnostics', async (_req, res) => {
    try { return res.status(200).json(await diagnostics.listDiagnostics()); } catch (error) { return sendError(res, error); }
  });

  router.get('/:id/governance', async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'invalid automationId' });
    try { return res.status(200).json(await governance.getPolicy(req.params.id)); } catch (error) { return sendError(res, error); }
  });
  router.put('/:id/governance', async (req, res) => {
    if (!validId(req.params.id) || !isObject(req.body)) return res.status(400).json({ error: 'invalid governance payload' });
    try { return res.status(200).json(await governance.updatePolicy(req.params.id, req.body)); } catch (error) { return sendError(res, error); }
  });
  router.get('/:id/diagnostics', async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'invalid automationId' });
    try { return res.status(200).json(await diagnostics.diagnose(req.params.id)); } catch (error) { return sendError(res, error); }
  });
  router.post('/:id/clear-block', async (req, res) => {
    if (!validId(req.params.id) || !emptyBody(req.body)) return res.status(400).json({ error: 'invalid clear-block request' });
    try { return res.status(200).json(await governance.clearBlock(req.params.id)); } catch (error) { return sendError(res, error); }
  });
  router.post('/:id/skip', async (req, res) => {
    if (!validId(req.params.id) || !emptyBody(req.body)) return res.status(400).json({ error: 'invalid skip request' });
    try { return res.status(201).json(await runner.skipOccurrence(req.params.id)); } catch (error) { return sendError(res, error); }
  });
  router.post('/:id/override', async (req, res) => {
    if (!validId(req.params.id) || !isObject(req.body) || !hasOnly(req.body, ['policies', 'reason', 'authorizedBy'])) return res.status(400).json({ error: 'invalid override request' });
    try { const result = await runner.runOverride(req.params.id, req.body as never); return res.status(result.created ? 201 : 200).json(result); }
    catch (error) { return sendError(res, error); }
  });

  router.post('/runs/:runId/retry', async (req, res) => {
    if (!validId(req.params.runId) || !emptyBody(req.body)) return res.status(400).json({ error: 'invalid retry request' });
    try { const result = await runner.retryRun(req.params.runId); return res.status(result.created ? 201 : 200).json(result); }
    catch (error) { return sendError(res, error); }
  });
  router.post('/runs/:runId/recover', async (req, res) => {
    if (!validId(req.params.runId) || !emptyBody(req.body)) return res.status(400).json({ error: 'invalid recovery request' });
    try { const result = await runner.recoverRun(req.params.runId); return res.status(result.created ? 201 : 200).json(result); }
    catch (error) { return sendError(res, error); }
  });

  router.post('/', async (req, res) => {
    if (!validCreate(req.body)) return res.status(400).json({ error: 'invalid automation payload' });
    try { return res.status(201).json(await service.create(req.body)); } catch (error) { return sendError(res, error); }
  });

  router.get('/', async (_req, res) => {
    try { return res.status(200).json(await service.list()); } catch (error) { return sendError(res, error); }
  });

  router.get('/due', async (req, res) => {
    const value = req.query.now;
    const now = value === undefined ? new Date() : typeof value === 'string' ? new Date(value) : new Date(NaN);
    if (Number.isNaN(now.getTime())) return res.status(400).json({ error: 'invalid now query' });
    try { return res.status(200).json(await scheduler.findDueAutomations(now)); } catch (error) { return sendError(res, error); }
  });

  router.post('/due/run', async (req, res) => {
    if (!isObject(req.body) || !hasOnly(req.body, ['now'])
      || (req.body.now !== undefined && typeof req.body.now !== 'string')) {
      return res.status(400).json({ error: 'invalid due-run payload' });
    }
    const now = req.body.now === undefined ? new Date() : new Date(req.body.now);
    if (Number.isNaN(now.getTime())) return res.status(400).json({ error: 'invalid due-run timestamp' });
    try { return res.status(200).json(await scheduler.runDueAutomations(now)); } catch (error) { return sendError(res, error); }
  });

  router.get('/runs/:runId', async (req, res) => {
    if (!validId(req.params.runId)) return res.status(400).json({ error: 'invalid runId' });
    try { return res.status(200).json(await runner.getRun(req.params.runId)); } catch (error) { return sendError(res, error); }
  });

  router.post('/runs/:runId/execute', async (req, res) => {
    if (!validId(req.params.runId) || !emptyBody(req.body)) return res.status(400).json({ error: 'invalid run execution request' });
    try { return res.status(200).json(await runner.executeApprovedRun(req.params.runId)); } catch (error) { return sendError(res, error); }
  });

  router.get('/:id/runs', async (req, res) => {
    if (!validId(req.params.id) || !validLimit(req.query.limit)) return res.status(400).json({ error: 'invalid automation run query' });
    try { return res.status(200).json(await service.listRuns(req.params.id, req.query.limit ? Number(req.query.limit) : 50)); }
    catch (error) { return sendError(res, error); }
  });

  router.get('/:id/audit', async (req, res) => {
    if (!validId(req.params.id) || !validLimit(req.query.limit)) return res.status(400).json({ error: 'invalid automation audit query' });
    try { return res.status(200).json(await service.listAudit(req.params.id, req.query.limit ? Number(req.query.limit) : 100)); }
    catch (error) { return sendError(res, error); }
  });

  router.post('/:id/run', async (req, res) => {
    if (!validId(req.params.id) || !emptyBody(req.body)) return res.status(400).json({ error: 'invalid run request' });
    try {
      const result = await runner.runNow(req.params.id);
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) { return sendError(res, error); }
  });

  for (const [action, handler] of [
    ['enable', (id: string) => service.enable(id)], ['disable', (id: string) => service.disable(id)],
    ['pause', (id: string) => service.pause(id)], ['resume', (id: string) => service.resume(id)],
  ] as const) {
    router.post(`/:id/${action}`, async (req, res) => {
      if (!validId(req.params.id) || !emptyBody(req.body)) return res.status(400).json({ error: `invalid ${action} request` });
      try { return res.status(200).json(await handler(req.params.id)); } catch (error) { return sendError(res, error); }
    });
  }

  router.get('/:id', async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'invalid automationId' });
    try { return res.status(200).json(await service.getById(req.params.id)); } catch (error) { return sendError(res, error); }
  });

  router.patch('/:id', async (req, res) => {
    if (!validId(req.params.id) || !validUpdate(req.body)) return res.status(400).json({ error: 'invalid automation payload' });
    try { return res.status(200).json(await service.update(req.params.id, req.body)); } catch (error) { return sendError(res, error); }
  });

  return router;
};

export default createAutomationsRouter();
