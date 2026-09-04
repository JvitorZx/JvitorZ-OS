import { Router } from 'express';
import {
  MonitoringControlConflictError,
  MonitoringControlService,
  MonitoringControlValidationError,
  StrategicMonitoringService,
  StrategicMonitoringValidationError,
  StrategicSignalConflictError,
  StrategicSignalNotFoundError,
} from '../services/strategic-monitoring';
import { automationRuntime } from '../services/automation/AutomationRuntimeService';

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const hasOnly = (value: Record<string, unknown>, fields: readonly string[]) => Object.keys(value).every((field) => fields.includes(field));
const optionalText = (value: unknown): value is string | null | undefined => value == null || typeof value === 'string';
const emptyBody = (value: unknown) => value === undefined || (isObject(value) && Object.keys(value).length === 0);

const sendError = (res: Parameters<Parameters<Router['get']>[1]>[1], error: unknown) => {
  if (error instanceof StrategicMonitoringValidationError) return res.status(400).json({ error: error.message });
  if (error instanceof MonitoringControlValidationError) return res.status(400).json({ error: error.message });
  if (error instanceof MonitoringControlConflictError) return res.status(409).json({ error: error.message });
  if (error instanceof StrategicSignalNotFoundError) return res.status(404).json({ error: error.message });
  if (error instanceof StrategicSignalConflictError) return res.status(409).json({ error: error.message });
  const name = error instanceof Error ? error.name : 'UnknownError';
  console.error(`Strategic monitoring request failed (${name})`);
  return res.status(500).json({ error: 'Strategic monitoring request failed' });
};

export const createMonitoringRouter = (
  service: StrategicMonitoringService = new StrategicMonitoringService(),
  providedControl?: MonitoringControlService,
): Router => {
  const router = Router();
  const control = providedControl ?? new MonitoringControlService(
    undefined, service, undefined, undefined, () => automationRuntime.getHealth(),
  );

  router.get('/control', async (req, res) => {
    if (Object.keys(req.query).length) return res.status(400).json({ error: 'invalid monitoring control query' });
    try { return res.status(200).json(await control.getState()); }
    catch (error) { return sendError(res, error); }
  });

  router.patch('/control', async (req, res) => {
    if (!isObject(req.body) || !hasOnly(req.body, ['intervalMs']) || Object.keys(req.body).length !== 1
      || !Number.isInteger(req.body.intervalMs)) {
      return res.status(400).json({ error: 'invalid monitoring control payload' });
    }
    try { return res.status(200).json(await control.updateCadence(req.body.intervalMs as number)); }
    catch (error) { return sendError(res, error); }
  });

  router.post('/control/enable', async (req, res) => {
    if (!emptyBody(req.body)) return res.status(400).json({ error: 'monitoring enable body must be empty' });
    try { return res.status(200).json(await control.enable()); }
    catch (error) { return sendError(res, error); }
  });

  router.post('/control/disable', async (req, res) => {
    if (!emptyBody(req.body)) return res.status(400).json({ error: 'monitoring disable body must be empty' });
    try { return res.status(200).json(await control.disable()); }
    catch (error) { return sendError(res, error); }
  });

  router.post('/control/run', async (req, res) => {
    if (!emptyBody(req.body)) return res.status(400).json({ error: 'monitoring run body must be empty' });
    try { return res.status(200).json(await control.runNow()); }
    catch (error) { return sendError(res, error); }
  });

  router.get('/signals', async (req, res) => {
    if (!hasOnly(req.query as Record<string, unknown>, ['projectId', 'state', 'severity', 'type', 'limit'])
      || !optionalText(req.query.projectId) || !optionalText(req.query.state)
      || !optionalText(req.query.severity) || !optionalText(req.query.type)
      || (req.query.limit !== undefined && (typeof req.query.limit !== 'string' || !/^\d+$/.test(req.query.limit)))) {
      return res.status(400).json({ error: 'invalid monitoring query' });
    }
    try {
      return res.status(200).json(await service.list({
        ...('projectId' in req.query ? { projectId: req.query.projectId || null } : {}),
        ...(req.query.state ? { state: req.query.state } : {}),
        ...(req.query.severity ? { severity: req.query.severity } : {}),
        ...(req.query.type ? { type: req.query.type } : {}),
        ...(req.query.limit ? { limit: Number(req.query.limit) } : {}),
      }));
    } catch (error) { return sendError(res, error); }
  });

  router.post('/evaluate', async (req, res) => {
    if (!isObject(req.body) || !hasOnly(req.body, ['projectId']) || !optionalText(req.body.projectId)) {
      return res.status(400).json({ error: 'invalid monitoring evaluation payload' });
    }
    try {
      const result = await control.runNow('projectId' in req.body ? req.body.projectId || null : undefined);
      return res.status(200).json(result.evaluation);
    }
    catch (error) { return sendError(res, error); }
  });

  router.get('/signals/:id', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id || Object.keys(req.query).length) return res.status(400).json({ error: 'invalid strategic signal id' });
    try { return res.status(200).json(await service.get(id)); }
    catch (error) { return sendError(res, error); }
  });

  const transition = (action: 'acknowledge' | 'dismiss' | 'resolve') => async (
    req: Parameters<Parameters<Router['post']>[1]>[0],
    res: Parameters<Parameters<Router['post']>[1]>[1],
  ) => {
    const id = req.params.id?.trim();
    if (!id || !isObject(req.body) || !hasOnly(req.body, ['reason']) || !optionalText(req.body.reason)) {
      return res.status(400).json({ error: `invalid strategic signal ${action} payload` });
    }
    try { return res.status(200).json(await service[action](id, req.body.reason as string | null | undefined)); }
    catch (error) { return sendError(res, error); }
  };

  router.post('/signals/:id/acknowledge', transition('acknowledge'));
  router.post('/signals/:id/dismiss', transition('dismiss'));
  router.post('/signals/:id/resolve', transition('resolve'));

  return router;
};

export default createMonitoringRouter();
