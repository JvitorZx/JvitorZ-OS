import { Router, type Response } from 'express';
import {
  RESEARCH_INTENTS,
  RESEARCH_OPPORTUNITY_STATES,
  RESEARCH_SUBJECT_TYPES,
  type ResearchRequest,
} from '../domains/research';
import {
  ResearchNotFoundError,
  ResearchConflictError,
  ResearchIdeaConflictError,
  ResearchIdeaNotFoundError,
  ResearchIdeationService,
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
  if (error instanceof ResearchIdeaNotFoundError) return res.status(404).json({ error: error.message });
  if (error instanceof ResearchConflictError || error instanceof ResearchIdeaConflictError) return res.status(409).json({ error: error.message });
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

export const createResearchRouter = (service = new ResearchService(), studio = new ResearchIdeationService(service)): Router => {
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

  router.post('/sessions', async (req, res) => {
    if (!isObject(req.body) || !hasOnly(req.body, ['query', 'intent', 'projectId', 'subjectType', 'subject', 'objective', 'format', 'game', 'constraints'])
      || typeof req.body.query !== 'string' || !optionalString(req.body.projectId) || !optionalString(req.body.subject)
      || !optionalString(req.body.objective) || !optionalString(req.body.format) || !optionalString(req.body.game)
      || (req.body.intent !== undefined && !RESEARCH_INTENTS.includes(req.body.intent as never))
      || (req.body.subjectType !== undefined && !RESEARCH_SUBJECT_TYPES.includes(req.body.subjectType as never))
      || (req.body.constraints !== undefined && !Array.isArray(req.body.constraints))) return res.status(400).json({ error: 'invalid research session payload' });
    try { return res.status(201).json(await studio.createSession(req.body as unknown as Parameters<ResearchIdeationService['createSession']>[0])); } catch (error) { return sendError(res, error); }
  });
  router.get('/sessions', async (req, res) => {
    if (!hasOnly(req.query as Record<string, unknown>, ['projectId', 'status', 'limit']) || !optionalString(req.query.projectId) || !optionalString(req.query.status)
      || (req.query.limit !== undefined && (typeof req.query.limit !== 'string' || !/^\d+$/.test(req.query.limit)))) return res.status(400).json({ error: 'invalid research session filters' });
    try { return res.status(200).json(await studio.listSessions({
      ...('projectId' in req.query ? { projectId: typeof req.query.projectId === 'string' ? req.query.projectId.trim() || null : null } : {}),
      ...(typeof req.query.status === 'string' && req.query.status ? { status: req.query.status } : {}),
      ...(typeof req.query.limit === 'string' ? { limit: Number(req.query.limit) } : {}),
    })); } catch (error) { return sendError(res, error); }
  });
  router.get('/sessions/:id', async (req, res) => { try { return res.status(200).json(await studio.getSession(req.params.id)); } catch (error) { return sendError(res, error); } });
  router.get('/sessions/:id/evidence', async (req, res) => { try { return res.status(200).json((await studio.getSession(req.params.id)).evidenceItems); } catch (error) { return sendError(res, error); } });
  router.get('/sessions/:id/games', async (req, res) => { try { return res.status(200).json(await studio.listGameCandidates(req.params.id)); } catch (error) { return sendError(res, error); } });
  router.get('/sessions/:id/content', async (req, res) => { try { return res.status(200).json(await studio.getContentResearch(req.params.id)); } catch (error) { return sendError(res, error); } });
  for (const [action, invoke] of [
    ['run', (id: string) => studio.runSession(id)], ['rerun', (id: string) => studio.rerunSession(id)], ['archive', (id: string) => studio.archiveSession(id)],
  ] as const) router.post(`/sessions/:id/${action}`, async (req, res) => {
    if (!isObject(req.body) || Object.keys(req.body).length) return res.status(400).json({ error: 'request body must be empty' });
    try { return res.status(action === 'rerun' ? 201 : 200).json(await invoke(req.params.id)); } catch (error) { return sendError(res, error); }
  });

  router.post('/sessions/:id/ideas/generate', async (req, res) => {
    if (!isObject(req.body) || !hasOnly(req.body, ['objective', 'format', 'effort', 'game', 'series', 'limit'])) return res.status(400).json({ error: 'invalid idea generation payload' });
    try { return res.status(201).json(await studio.generateIdeas(req.params.id, req.body as never)); } catch (error) { return sendError(res, error); }
  });
  router.get('/ideas', async (req, res) => {
    if (!hasOnly(req.query as Record<string, unknown>, ['projectId', 'status', 'researchHistoryId', 'limit'])
      || !optionalString(req.query.projectId) || !optionalString(req.query.status) || !optionalString(req.query.researchHistoryId)
      || (req.query.limit !== undefined && (typeof req.query.limit !== 'string' || !/^\d+$/.test(req.query.limit)))) return res.status(400).json({ error: 'invalid idea filters' });
    try { return res.status(200).json(await studio.listIdeas({
      ...('projectId' in req.query ? { projectId: typeof req.query.projectId === 'string' ? req.query.projectId.trim() || null : null } : {}),
      ...(typeof req.query.status === 'string' && req.query.status ? { status: req.query.status } : {}),
      ...(typeof req.query.researchHistoryId === 'string' && req.query.researchHistoryId ? { researchHistoryId: req.query.researchHistoryId } : {}),
      ...(typeof req.query.limit === 'string' ? { limit: Number(req.query.limit) } : {}),
    })); } catch (error) { return sendError(res, error); }
  });
  router.get('/ideas/:id', async (req, res) => { try { return res.status(200).json(await studio.getIdea(req.params.id)); } catch (error) { return sendError(res, error); } });
  router.patch('/ideas/:id', async (req, res) => {
    if (!isObject(req.body) || !hasOnly(req.body, ['premise', 'coreEvent', 'viewerPromise', 'whyNow', 'effort', 'reason'])) return res.status(400).json({ error: 'invalid idea payload' });
    try { return res.status(200).json(await studio.editIdea(req.params.id, req.body)); } catch (error) { return sendError(res, error); }
  });
  router.post('/ideas/:id/status', async (req, res) => {
    if (!isObject(req.body) || !hasOnly(req.body, ['status', 'reason']) || typeof req.body.status !== 'string') return res.status(400).json({ error: 'invalid idea status payload' });
    try { return res.status(200).json(await studio.transitionIdea(req.params.id, req.body.status, req.body.reason)); } catch (error) { return sendError(res, error); }
  });
  router.post('/ideas/:id/experiment', async (req, res) => {
    if (!isObject(req.body) || !hasOnly(req.body, ['enabled', 'hypothesis'])) return res.status(400).json({ error: 'invalid experiment payload' });
    try { return res.status(200).json(await studio.markExperiment(req.params.id, req.body as never)); } catch (error) { return sendError(res, error); }
  });
  router.post('/ideas/:id/planner', async (req, res) => {
    if (!isObject(req.body) || Object.keys(req.body).length) return res.status(400).json({ error: 'request body must be empty' });
    try { const result = await studio.sendToPlanner(req.params.id); return res.status(result.created ? 201 : 200).json(result); } catch (error) { return sendError(res, error); }
  });

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
