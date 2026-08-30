import { Router, type Response } from 'express';
import {
  RESEARCH_INTENTS,
  RESEARCH_OPPORTUNITY_STATES,
  RESEARCH_SUBJECT_TYPES,
  type ResearchRequest,
} from '../domains/research';
import {
  ResearchNotFoundError,
  ResearchProviderUnavailableError,
  ResearchService,
  ResearchValidationError,
} from '../services/research';

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasOnly = (value: Record<string, unknown>, fields: readonly string[]): boolean =>
  Object.keys(value).every((field) => fields.includes(field));
const optionalString = (value: unknown): boolean => value === undefined || value === null || typeof value === 'string';

const validResearchBody = (body: unknown): body is ResearchRequest => isObject(body)
  && hasOnly(body, ['query', 'intent', 'projectId', 'subjectType', 'subject', 'forceRefresh'])
  && typeof body.query === 'string'
  && optionalString(body.projectId)
  && optionalString(body.subject)
  && (body.intent === undefined || RESEARCH_INTENTS.includes(body.intent as never))
  && (body.subjectType === undefined || RESEARCH_SUBJECT_TYPES.includes(body.subjectType as never))
  && (body.forceRefresh === undefined || typeof body.forceRefresh === 'boolean');

const sendError = (res: Response, error: unknown) => {
  if (error instanceof ResearchValidationError) return res.status(400).json({ error: error.message });
  if (error instanceof ResearchNotFoundError) return res.status(404).json({ error: error.message });
  if (error instanceof ResearchProviderUnavailableError) return res.status(503).json({ error: 'Research is temporarily unavailable' });
  const name = error instanceof Error ? error.name : 'UnknownError';
  console.error(`Research request failed (${name})`);
  return res.status(500).json({ error: 'Research request failed' });
};

const queryFilters = (query: Record<string, unknown>) => {
  if (!hasOnly(query, ['projectId', 'state', 'limit'])
    || !optionalString(query.projectId) || !optionalString(query.state)
    || (query.state !== undefined && !RESEARCH_OPPORTUNITY_STATES.includes(query.state as never))
    || (query.limit !== undefined && (typeof query.limit !== 'string' || !/^\d+$/.test(query.limit)))) {
    throw new ResearchValidationError('invalid research filters');
  }
  return {
    ...(query.projectId === undefined ? {} : { projectId: String(query.projectId).trim() || null }),
    ...(query.state === undefined ? {} : { state: String(query.state).trim() }),
    ...(query.limit === undefined ? {} : { limit: Number(query.limit) }),
  };
};

const serializeOpportunity = (item: Awaited<ReturnType<ResearchService['getOpportunity']>>) => ({
  id: item.id,
  researchHistoryId: item.researchHistoryId,
  projectId: item.researchHistory.projectId,
  query: item.researchHistory.query,
  researchedAt: item.researchHistory.researchedAt,
  key: item.key,
  rank: item.rank,
  subject: item.subject,
  subjectType: item.subjectType,
  state: item.state,
  summary: item.summary,
  sources: item.sources,
  evidence: item.evidence,
  freshness: item.freshness,
  compatibility: item.compatibility,
  confidence: item.confidence,
  risks: item.risks,
  gaps: item.gaps,
  nextInvestigation: item.nextInvestigation,
  createdAt: item.createdAt,
});

export const createResearchRouter = (service = new ResearchService()): Router => {
  const router = Router();

  const execute = (method: 'research' | 'researchGames' | 'researchTopics') => async (req: Parameters<Parameters<Router['post']>[1]>[0], res: Response) => {
    if (!validResearchBody(req.body)) return res.status(400).json({ error: 'invalid research payload' });
    try {
      return res.status(200).json(await service[method](req.body));
    } catch (error) { return sendError(res, error); }
  };
  router.post('/', execute('research'));
  router.post('/games', execute('researchGames'));
  router.post('/topics', execute('researchTopics'));

  router.get('/opportunities', async (req, res) => {
    try {
      const items = await service.listOpportunities(queryFilters(req.query));
      return res.status(200).json(items.map(serializeOpportunity));
    } catch (error) { return sendError(res, error); }
  });
  router.get('/opportunities/:id', async (req, res) => {
    try { return res.status(200).json(serializeOpportunity(await service.getOpportunity(req.params.id))); }
    catch (error) { return sendError(res, error); }
  });
  router.get('/history', async (req, res) => {
    try {
      const filters = queryFilters(req.query);
      return res.status(200).json(await service.listHistory({ projectId: filters.projectId, limit: filters.limit }));
    } catch (error) { return sendError(res, error); }
  });
  router.get('/history/:id', async (req, res) => {
    try { return res.status(200).json(await service.getHistory(req.params.id)); }
    catch (error) { return sendError(res, error); }
  });
  router.post('/history/:id/refresh', async (req, res) => {
    if (!isObject(req.body) || Object.keys(req.body).length > 0) return res.status(400).json({ error: 'request body must be empty' });
    try { return res.status(200).json(await service.refresh(req.params.id)); }
    catch (error) { return sendError(res, error); }
  });
  return router;
};

export default createResearchRouter();
