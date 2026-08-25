import { Router, type Response } from 'express';
import {
  CreatorIntelligenceService,
  CreatorIntelligenceValidationError,
  VideoIdeaNotFoundError,
} from '../services/creator-intelligence/CreatorIntelligenceService';
import { PerformanceValidationError } from '../services/performance-intelligence/PerformanceNormalizer';

const PERFORMANCE_RECORD_FIELDS = [
  'videoId', 'title', 'projectId', 'game', 'series', 'format', 'publishedAt',
  'periodStart', 'periodEnd', 'views', 'impressions', 'ctr', 'durationSeconds',
  'averageViewDurationSeconds', 'averageViewPercentage', 'watchTimeMinutes',
  'subscribersGained', 'likes', 'comments', 'confidence', 'collectedAt',
] as const;

const IDEA_FIELDS = [
  'projectId',
  'game',
  'theme',
  'format',
  'premise',
  'estimatedEffort',
  'novelty',
  'identityFit',
] as const;

const isObjectBody = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyFields = (body: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(body).every((field) => allowed.includes(field));

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string';

const isOptionalNumber = (value: unknown): value is number | undefined =>
  value === undefined || typeof value === 'number';

const isEmptyBody = (body: unknown): boolean =>
  body === undefined || (isObjectBody(body) && Object.keys(body).length === 0);

const sendSafeError = (res: Response): void => {
  res.status(500).json({ error: 'Creator intelligence operation failed' });
};

export const createCreatorIntelligenceRouter = (
  service: CreatorIntelligenceService = new CreatorIntelligenceService(),
): Router => {
  const router = Router();

  router.post('/ideas', async (req, res) => {
    if (!isObjectBody(req.body) || !hasOnlyFields(req.body, IDEA_FIELDS)) {
      return res.status(400).json({ error: 'invalid idea payload' });
    }

    const body = req.body;
    if (
      !isOptionalString(body.projectId)
      || !isOptionalString(body.game)
      || typeof body.theme !== 'string'
      || typeof body.format !== 'string'
      || typeof body.premise !== 'string'
      || !isOptionalNumber(body.estimatedEffort)
      || !isOptionalNumber(body.novelty)
      || !isOptionalNumber(body.identityFit)
    ) {
      return res.status(400).json({ error: 'invalid idea payload' });
    }

    try {
      const idea = await service.registerIdea({
        projectId: body.projectId,
        game: body.game,
        theme: body.theme,
        format: body.format,
        premise: body.premise,
        estimatedEffort: body.estimatedEffort,
        novelty: body.novelty,
        identityFit: body.identityFit,
      });
      return res.status(201).json(idea);
    } catch (error) {
      if (error instanceof CreatorIntelligenceValidationError) {
        return res.status(400).json({ error: error.message });
      }
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to register creator intelligence idea (${name})`);
      sendSafeError(res);
      return;
    }
  });

  router.get('/ideas', async (req, res) => {
    const projectId = req.query.projectId;
    if (projectId !== undefined && typeof projectId !== 'string') {
      return res.status(400).json({ error: 'projectId must be a string' });
    }

    try {
      return res.status(200).json(await service.listIdeas(projectId));
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to list creator intelligence ideas (${name})`);
      sendSafeError(res);
      return;
    }
  });

  router.post('/ideas/:id/evaluate', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id || !isEmptyBody(req.body)) {
      return res.status(400).json({ error: 'id is required and body must be empty' });
    }

    try {
      return res.status(200).json(await service.evaluateIdea(id));
    } catch (error) {
      if (error instanceof VideoIdeaNotFoundError) {
        return res.status(404).json({ error: 'Video idea not found' });
      }
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to evaluate creator intelligence idea (${name})`);
      sendSafeError(res);
      return;
    }
  });

  router.post('/ideas/compare', async (req, res) => {
    if (
      !isObjectBody(req.body)
      || !hasOnlyFields(req.body, ['ideaIds'])
      || !Array.isArray(req.body.ideaIds)
      || !req.body.ideaIds.every((id) => typeof id === 'string')
    ) {
      return res.status(400).json({ error: 'ideaIds must be an array of strings' });
    }

    try {
      return res.status(200).json(await service.compareIdeas(req.body.ideaIds));
    } catch (error) {
      if (error instanceof CreatorIntelligenceValidationError) {
        return res.status(400).json({ error: error.message });
      }
      if (error instanceof VideoIdeaNotFoundError) {
        return res.status(404).json({ error: 'Video idea not found' });
      }
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to compare creator intelligence ideas (${name})`);
      sendSafeError(res);
      return;
    }
  });

  router.get('/recommendation', async (req, res) => {
    const projectId = req.query.projectId;
    if (projectId !== undefined && typeof projectId !== 'string') {
      return res.status(400).json({ error: 'projectId must be a string' });
    }

    try {
      return res.status(200).json(await service.recommendEditorial(projectId));
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to recommend creator intelligence idea (${name})`);
      sendSafeError(res);
      return;
    }
  });

  router.get('/context', async (req, res) => {
    const projectId = req.query.projectId;
    if (projectId !== undefined && typeof projectId !== 'string') {
      return res.status(400).json({ error: 'projectId must be a string' });
    }

    try {
      return res.status(200).json(await service.buildContext(projectId));
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to build creator intelligence context (${name})`);
      sendSafeError(res);
      return;
    }
  });

  router.post('/performance/ingest/manual', async (req, res) => {
    if (
      !isObjectBody(req.body)
      || !hasOnlyFields(req.body, ['projectId', 'records'])
      || !isOptionalString(req.body.projectId)
      || !Array.isArray(req.body.records)
      || req.body.records.length === 0
      || req.body.records.length > 100
      || !req.body.records.every((record) => isObjectBody(record)
        && hasOnlyFields(record, PERFORMANCE_RECORD_FIELDS))
    ) {
      return res.status(400).json({ error: 'invalid performance ingestion payload' });
    }

    try {
      const result = await service.ingestManualPerformance(req.body.records, req.body.projectId);
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof PerformanceValidationError) {
        return res.status(400).json({ error: error.message });
      }
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to ingest performance records (${name})`);
      sendSafeError(res);
      return;
    }
  });

  router.get('/performance/records', async (req, res) => {
    const projectId = req.query.projectId;
    if (projectId !== undefined && typeof projectId !== 'string') {
      return res.status(400).json({ error: 'projectId must be a string' });
    }
    try {
      return res.status(200).json(await service.listPerformanceRecords(projectId));
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to list performance records (${name})`);
      sendSafeError(res);
      return;
    }
  });

  router.get('/performance/signals', async (req, res) => {
    const projectId = req.query.projectId;
    if (projectId !== undefined && typeof projectId !== 'string') {
      return res.status(400).json({ error: 'projectId must be a string' });
    }
    try {
      return res.status(200).json(await service.listPerformanceSignals(projectId));
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to list performance signals (${name})`);
      sendSafeError(res);
      return;
    }
  });

  router.get('/performance/baseline', async (req, res) => {
    const projectId = req.query.projectId;
    if (projectId !== undefined && typeof projectId !== 'string') {
      return res.status(400).json({ error: 'projectId must be a string' });
    }
    try {
      return res.status(200).json(await service.getPerformanceBaseline(projectId));
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to calculate performance baseline (${name})`);
      sendSafeError(res);
      return;
    }
  });

  router.get('/learnings', async (req, res) => {
    const projectId = req.query.projectId;
    if (projectId !== undefined && typeof projectId !== 'string') {
      return res.status(400).json({ error: 'projectId must be a string' });
    }
    try {
      return res.status(200).json(await service.getChannelLearnings(projectId));
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to list channel learnings (${name})`);
      sendSafeError(res);
      return;
    }
  });

  router.get('/decisions/:id/evidence', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    try {
      const decision = await service.getDecisionEvidence(id);
      if (!decision) return res.status(404).json({ error: 'Content decision not found' });
      return res.status(200).json({
        id: decision.id,
        videoIdeaId: decision.videoIdeaId,
        category: decision.category,
        score: decision.score,
        rationale: decision.rationale,
        evidence: decision.evidence,
        createdAt: decision.createdAt,
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to fetch decision evidence (${name})`);
      sendSafeError(res);
      return;
    }
  });

  return router;
};
