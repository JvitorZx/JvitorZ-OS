import { Router } from 'express';
import { CHANNEL_CONTEXT_STATUSES, CHANNEL_CONTEXT_TYPES, type ChannelContextFilters } from '../domains/channel-context';
import {
  ChannelContextConflictError,
  ChannelContextNotFoundError,
  ChannelContextResolver,
  ChannelContextService,
  ChannelContextValidationError,
} from '../services/channel-context';

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const hasOnly = (value: Record<string, unknown>, fields: readonly string[]) => Object.keys(value).every((field) => fields.includes(field));
const CREATE_FIELDS = ['projectId', 'channelId', 'type', 'status', 'category', 'subject', 'statement', 'confidence', 'source', 'sourceReference', 'occurredAt', 'periodStart', 'periodEnd', 'entityType', 'entityId', 'game', 'series', 'format', 'metadata'] as const;
const UPDATE_FIELDS = ['status', 'statement', 'confidence', 'occurredAt', 'periodStart', 'periodEnd', 'metadata'] as const;
const QUERY_FIELDS = ['projectId', 'type', 'status', 'category', 'entityType', 'entityId', 'periodFrom', 'periodTo', 'currentOnly', 'limit'] as const;

const sendError = (res: Parameters<Parameters<Router['get']>[1]>[1], error: unknown) => {
  if (error instanceof ChannelContextValidationError) return res.status(400).json({ error: error.message });
  if (error instanceof ChannelContextNotFoundError) return res.status(404).json({ error: error.message });
  if (error instanceof ChannelContextConflictError) return res.status(409).json({ error: error.message });
  console.error(`Channel context request failed (${error instanceof Error ? error.name : 'UnknownError'})`);
  return res.status(500).json({ error: 'Channel context request failed' });
};

const listFilters = (query: Record<string, unknown>): ChannelContextFilters => {
  if (!hasOnly(query, QUERY_FIELDS)) throw new ChannelContextValidationError('query is invalid');
  const value = (field: string) => typeof query[field] === 'string' && query[field] ? String(query[field]) : undefined;
  const type = value('type'); const status = value('status');
  if (type && !CHANNEL_CONTEXT_TYPES.includes(type as never)) throw new ChannelContextValidationError('type is invalid');
  if (status && !CHANNEL_CONTEXT_STATUSES.includes(status as never)) throw new ChannelContextValidationError('status is invalid');
  const limitText = value('limit'); const limit = limitText === undefined ? undefined : Number(limitText);
  if (limitText !== undefined && (!/^\d+$/.test(limitText) || !Number.isInteger(limit))) throw new ChannelContextValidationError('limit is invalid');
  const parseDate = (field: string) => { const raw = value(field); if (!raw) return undefined; const parsed = new Date(raw); if (Number.isNaN(parsed.getTime())) throw new ChannelContextValidationError(`${field} is invalid`); return parsed; };
  const currentOnly = value('currentOnly');
  if (currentOnly && !['true', 'false'].includes(currentOnly)) throw new ChannelContextValidationError('currentOnly is invalid');
  return {
    ...('projectId' in query ? { projectId: value('projectId') ?? null } : {}),
    ...(type ? { type: type as never } : {}), ...(status ? { status: status as never } : {}),
    ...(value('category') ? { category: value('category') } : {}),
    ...(value('entityType') ? { entityType: value('entityType') } : {}), ...(value('entityId') ? { entityId: value('entityId') } : {}),
    ...(parseDate('periodFrom') ? { periodFrom: parseDate('periodFrom') } : {}), ...(parseDate('periodTo') ? { periodTo: parseDate('periodTo') } : {}),
    ...(currentOnly ? { currentOnly: currentOnly === 'true' } : {}), ...(limit !== undefined ? { limit } : {}),
  };
};

export const createChannelContextRouter = (
  service: ChannelContextService = new ChannelContextService(),
  resolver: ChannelContextResolver = new ChannelContextResolver(),
): Router => {
  const router = Router();

  router.get('/', async (req, res) => {
    try { return res.status(200).json(await service.list(listFilters(req.query as Record<string, unknown>))); }
    catch (error) { return sendError(res, error); }
  });

  router.get('/resolve', async (req, res) => {
    const query = req.query as Record<string, unknown>;
    const allowed = ['projectId', 'text', 'type', 'entityType', 'entityId', 'game', 'series', 'format', 'subject', 'limit'];
    if (!hasOnly(query, allowed)) return res.status(400).json({ error: 'resolver query is invalid' });
    try {
      const limit = query.limit === undefined ? undefined : Number(query.limit);
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 20)) throw new ChannelContextValidationError('limit is invalid');
      const types = typeof query.type === 'string' && query.type ? query.type.split(',') : undefined;
      if (types?.some((type) => !CHANNEL_CONTEXT_TYPES.includes(type as never))) throw new ChannelContextValidationError('type is invalid');
      return res.status(200).json(await resolver.resolve({
        ...('projectId' in query ? { projectId: typeof query.projectId === 'string' && query.projectId ? query.projectId : null } : {}),
        ...(typeof query.text === 'string' ? { text: query.text } : {}), ...(types ? { types: types as never } : {}),
        ...Object.fromEntries(['entityType', 'entityId', 'game', 'series', 'format', 'subject'].flatMap((field) => typeof query[field] === 'string' && query[field] ? [[field, query[field]]] : [])),
        ...(limit ? { limit } : {}),
      }));
    } catch (error) { return sendError(res, error); }
  });

  router.post('/', async (req, res) => {
    if (!isObject(req.body) || !hasOnly(req.body, CREATE_FIELDS)) return res.status(400).json({ error: 'payload is invalid' });
    try { return res.status(201).json(await service.create(req.body as never)); }
    catch (error) { return sendError(res, error); }
  });

  router.get('/:id', async (req, res) => {
    if (!req.params.id?.trim() || Object.keys(req.query).length) return res.status(400).json({ error: 'id is invalid' });
    try { return res.status(200).json(await service.get(req.params.id)); }
    catch (error) { return sendError(res, error); }
  });

  router.patch('/:id', async (req, res) => {
    if (!req.params.id?.trim() || !isObject(req.body) || !hasOnly(req.body, UPDATE_FIELDS) || !Object.keys(req.body).length) return res.status(400).json({ error: 'payload is invalid' });
    try { return res.status(200).json(await service.update(req.params.id, req.body)); }
    catch (error) { return sendError(res, error); }
  });

  router.post('/:id/supersede', async (req, res) => {
    if (!req.params.id?.trim() || !isObject(req.body) || !hasOnly(req.body, CREATE_FIELDS)) return res.status(400).json({ error: 'payload is invalid' });
    try { return res.status(201).json(await service.supersede(req.params.id, req.body as never)); }
    catch (error) { return sendError(res, error); }
  });

  router.post('/:id/relations', async (req, res) => {
    if (!req.params.id?.trim() || !isObject(req.body) || !hasOnly(req.body, ['relation', 'entityType', 'entityId'])) return res.status(400).json({ error: 'payload is invalid' });
    try { return res.status(200).json(await service.relate(req.params.id, req.body as never)); }
    catch (error) { return sendError(res, error); }
  });

  return router;
};

export default createChannelContextRouter();
