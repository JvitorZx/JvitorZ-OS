import { Router, type Response } from 'express';
import {
  CreatorIntelligenceService,
  CreatorIntelligenceValidationError,
  VideoIdeaNotFoundError,
} from '../services/creator-intelligence/CreatorIntelligenceService';
import {
  EditorialDecisionConversationNotFoundError,
  EditorialDecisionNotFoundError,
  EditorialDecisionService,
  EditorialDecisionSnapshotNotFoundError,
  EditorialDecisionValidationError,
} from '../services/creator-intelligence/EditorialDecisionService';
import {
  DecisionOutcomeDecisionNotFoundError,
  DecisionOutcomeLinkConflictError,
  DecisionOutcomeLinkNotFoundError,
  DecisionOutcomeService,
  DecisionOutcomeSnapshotNotFoundError,
  DecisionOutcomeValidationError,
} from '../services/creator-intelligence/DecisionOutcomeService';
import { PerformanceValidationError } from '../services/performance-intelligence/PerformanceNormalizer';
import {
  YouTubeAnalyticsNotAuthorizedError,
  YouTubeAnalyticsNotConfiguredError,
  YouTubeAnalyticsQuotaError,
  YouTubeAnalyticsTemporaryError,
  YouTubePerformanceSyncService,
  YouTubePerformanceSyncValidationError,
  YouTubeVideoNotFoundError,
} from '../services/performance-intelligence/YouTubePerformanceSyncService';

const PERFORMANCE_RECORD_FIELDS = [
  'videoId', 'title', 'projectId', 'game', 'series', 'format', 'publishedAt',
  'periodStart', 'periodEnd', 'views', 'engagedViews', 'impressions', 'ctr', 'durationSeconds',
  'averageViewDurationSeconds', 'averageViewPercentage', 'watchTimeMinutes',
  'subscribersGained', 'subscribersLost', 'likes', 'comments', 'confidence', 'collectedAt',
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
  youtubeSyncService: YouTubePerformanceSyncService = new YouTubePerformanceSyncService(),
  editorialDecisionService: EditorialDecisionService = new EditorialDecisionService(service),
  decisionOutcomeService: DecisionOutcomeService = new DecisionOutcomeService(),
): Router => {
  const router = Router();

  router.post('/editorial-decisions', async (req, res) => {
    const fields = ['question', 'projectId', 'conversationId', 'ideaIds', 'videoId'];
    if (!isObjectBody(req.body) || !hasOnlyFields(req.body, fields)) {
      return res.status(400).json({ error: 'invalid editorial decision payload' });
    }
    const body = req.body;
    if (
      typeof body.question !== 'string'
      || !isOptionalString(body.projectId)
      || !isOptionalString(body.conversationId)
      || !isOptionalString(body.videoId)
      || (body.ideaIds !== undefined && (
        !Array.isArray(body.ideaIds) || !body.ideaIds.every((id) => typeof id === 'string')
      ))
    ) {
      return res.status(400).json({ error: 'invalid editorial decision payload' });
    }
    try {
      const result = await editorialDecisionService.generate({
        question: body.question,
        projectId: body.projectId,
        conversationId: body.conversationId,
        videoId: body.videoId,
        ideaIds: body.ideaIds as string[] | undefined,
      });
      return res.status(result.created ? 201 : 200).json(result.decision);
    } catch (error) {
      if (error instanceof EditorialDecisionConversationNotFoundError) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      if (error instanceof VideoIdeaNotFoundError) {
        return res.status(404).json({ error: 'Video idea not found' });
      }
      if (error instanceof EditorialDecisionValidationError) {
        return res.status(400).json({ error: error.message });
      }
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to generate editorial decision (${name})`);
      return res.status(500).json({ error: 'Failed to generate editorial decision' });
    }
  });

  router.get('/editorial-decisions', async (req, res) => {
    if (!Object.keys(req.query).every((field) => ['projectId', 'conversationId', 'limit'].includes(field))) {
      return res.status(400).json({ error: 'invalid editorial decision filters' });
    }
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const conversationId = typeof req.query.conversationId === 'string'
      ? req.query.conversationId : undefined;
    const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
    if (
      (req.query.projectId !== undefined && projectId === undefined)
      || (req.query.conversationId !== undefined && conversationId === undefined)
      || (req.query.limit !== undefined && !Number.isInteger(limit))
    ) {
      return res.status(400).json({ error: 'invalid editorial decision filters' });
    }
    try {
      return res.status(200).json(await editorialDecisionService.list({
        ...(projectId !== undefined ? { projectId } : {}),
        ...(conversationId !== undefined ? { conversationId } : {}),
        ...(limit !== undefined ? { limit } : {}),
      }));
    } catch (error) {
      if (error instanceof EditorialDecisionValidationError) {
        return res.status(400).json({ error: error.message });
      }
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to list editorial decisions (${name})`);
      return res.status(500).json({ error: 'Failed to list editorial decisions' });
    }
  });

  router.get('/editorial-decisions/:id', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    try {
      const decision = await editorialDecisionService.getById(id);
      if (!decision) return res.status(404).json({ error: 'Editorial decision not found' });
      return res.status(200).json(decision);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to open editorial decision (${name})`);
      return res.status(500).json({ error: 'Failed to open editorial decision' });
    }
  });

  router.post('/editorial-decisions/:id/outcome', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (
      !isObjectBody(req.body)
      || !hasOnlyFields(req.body, ['snapshotId'])
      || typeof req.body.snapshotId !== 'string'
      || !req.body.snapshotId.trim()
    ) {
      return res.status(400).json({ error: 'snapshotId is required' });
    }
    try {
      return res.status(200).json(await editorialDecisionService.registerOutcome(id, req.body.snapshotId));
    } catch (error) {
      if (error instanceof EditorialDecisionNotFoundError) {
        return res.status(404).json({ error: 'Editorial decision not found' });
      }
      if (error instanceof EditorialDecisionSnapshotNotFoundError) {
        return res.status(404).json({ error: 'Performance snapshot not found' });
      }
      if (error instanceof EditorialDecisionValidationError) {
        return res.status(409).json({ error: error.message });
      }
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to register editorial outcome (${name})`);
      return res.status(500).json({ error: 'Failed to register editorial outcome' });
    }
  });

  const sendDecisionOutcomeError = (error: unknown, operation: string) => {
    if (
      error instanceof DecisionOutcomeDecisionNotFoundError
      || error instanceof DecisionOutcomeSnapshotNotFoundError
      || error instanceof DecisionOutcomeLinkNotFoundError
    ) {
      return { status: 404, body: { error: error.message } };
    }
    if (error instanceof DecisionOutcomeLinkConflictError) {
      return { status: 409, body: { error: error.message } };
    }
    if (error instanceof DecisionOutcomeValidationError) {
      return { status: 400, body: { error: error.message } };
    }
    const name = error instanceof Error ? error.name : 'UnknownError';
    console.error(`${operation} (${name})`);
    return { status: 500, body: { error: 'Decision outcome operation failed' } };
  };

  router.post('/editorial-decisions/:id/videos', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id) return res.status(400).json({ error: 'decision id is required' });
    if (
      !isObjectBody(req.body)
      || !hasOnlyFields(req.body, ['snapshotId', 'origin', 'notes'])
      || typeof req.body.snapshotId !== 'string'
      || !isOptionalString(req.body.origin)
      || !isOptionalString(req.body.notes)
    ) {
      return res.status(400).json({ error: 'invalid decision video link payload' });
    }
    try {
      const result = await decisionOutcomeService.linkVideo(id, {
        snapshotId: req.body.snapshotId,
        origin: req.body.origin,
        notes: req.body.notes,
      });
      return res.status(result.created ? 201 : 200).json(result.link);
    } catch (error) {
      const mapped = sendDecisionOutcomeError(error, 'Failed to link editorial decision video');
      return res.status(mapped.status).json(mapped.body);
    }
  });

  router.get('/editorial-decisions/:id/videos', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id) return res.status(400).json({ error: 'decision id is required' });
    try {
      return res.status(200).json(await decisionOutcomeService.listLinks(id));
    } catch (error) {
      const mapped = sendDecisionOutcomeError(error, 'Failed to list editorial decision videos');
      return res.status(mapped.status).json(mapped.body);
    }
  });

  router.delete('/editorial-decisions/:decisionId/videos/:linkId', async (req, res) => {
    const decisionId = req.params.decisionId?.trim();
    const linkId = req.params.linkId?.trim();
    if (!decisionId || !linkId) return res.status(400).json({ error: 'decision id and link id are required' });
    try {
      await decisionOutcomeService.removeLink(decisionId, linkId);
      return res.status(204).send();
    } catch (error) {
      const mapped = sendDecisionOutcomeError(error, 'Failed to remove editorial decision video');
      return res.status(mapped.status).json(mapped.body);
    }
  });

  router.post('/editorial-decisions/:decisionId/videos/:linkId/outcomes', async (req, res) => {
    const decisionId = req.params.decisionId?.trim();
    const linkId = req.params.linkId?.trim();
    if (!decisionId || !linkId) return res.status(400).json({ error: 'decision id and link id are required' });
    if (
      !isObjectBody(req.body)
      || !hasOnlyFields(req.body, ['snapshotId'])
      || !isOptionalString(req.body.snapshotId)
    ) {
      return res.status(400).json({ error: 'invalid decision outcome payload' });
    }
    try {
      const links = await decisionOutcomeService.listLinks(decisionId);
      if (!links.some(({ id }) => id === linkId)) {
        return res.status(404).json({ error: 'Decision video link not found' });
      }
      const result = await decisionOutcomeService.evaluate(linkId, req.body.snapshotId);
      return res.status(result.created ? 201 : 200).json(result.outcome);
    } catch (error) {
      const mapped = sendDecisionOutcomeError(error, 'Failed to evaluate editorial decision outcome');
      return res.status(mapped.status).json(mapped.body);
    }
  });

  router.get('/editorial-decisions/:id/outcomes', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id) return res.status(400).json({ error: 'decision id is required' });
    try {
      await decisionOutcomeService.listLinks(id);
      return res.status(200).json(await decisionOutcomeService.listOutcomes({ decisionId: id, limit: 50 }));
    } catch (error) {
      const mapped = sendDecisionOutcomeError(error, 'Failed to list editorial decision outcomes');
      return res.status(mapped.status).json(mapped.body);
    }
  });

  router.get('/decision-outcomes', async (req, res) => {
    const allowed = ['projectId', 'conversationId', 'decisionId', 'videoId', 'limit'];
    if (!Object.keys(req.query).every((field) => allowed.includes(field))) {
      return res.status(400).json({ error: 'invalid decision outcome filters' });
    }
    const values = Object.fromEntries(allowed.flatMap((field) => (
      req.query[field] === undefined ? [] : [[field, req.query[field]]]
    ))) as Record<string, unknown>;
    if (Object.entries(values).some(([field, value]) => field !== 'limit' && typeof value !== 'string')) {
      return res.status(400).json({ error: 'invalid decision outcome filters' });
    }
    const limit = values.limit === undefined ? undefined : Number(values.limit);
    if (values.limit !== undefined && !Number.isInteger(limit)) {
      return res.status(400).json({ error: 'invalid decision outcome filters' });
    }
    try {
      return res.status(200).json(await decisionOutcomeService.listOutcomes({
        ...(typeof values.projectId === 'string' ? { projectId: values.projectId } : {}),
        ...(typeof values.conversationId === 'string' ? { conversationId: values.conversationId } : {}),
        ...(typeof values.decisionId === 'string' ? { decisionId: values.decisionId } : {}),
        ...(typeof values.videoId === 'string' ? { videoId: values.videoId } : {}),
        ...(limit !== undefined ? { limit } : {}),
      }));
    } catch (error) {
      const mapped = sendDecisionOutcomeError(error, 'Failed to list decision outcomes');
      return res.status(mapped.status).json(mapped.body);
    }
  });

  router.get('/decision-outcomes/:id', async (req, res) => {
    const id = req.params.id?.trim();
    if (!id) return res.status(400).json({ error: 'outcome id is required' });
    try {
      const outcome = await decisionOutcomeService.getOutcome(id);
      if (!outcome) return res.status(404).json({ error: 'Decision outcome not found' });
      return res.status(200).json(outcome);
    } catch (error) {
      const mapped = sendDecisionOutcomeError(error, 'Failed to open decision outcome');
      return res.status(mapped.status).json(mapped.body);
    }
  });

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

  router.get('/performance/youtube/status', async (_req, res) => {
    try {
      return res.status(200).json(await youtubeSyncService.getStatus());
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to read YouTube Analytics status (${name})`);
      return res.status(503).json({
        state: 'temporary_error',
        lastSyncAt: null,
        lastErrorType: 'temporary',
      });
    }
  });

  router.get('/performance/youtube/last-sync', async (_req, res) => {
    try {
      return res.status(200).json(await youtubeSyncService.getLastSync());
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to read YouTube Analytics last sync (${name})`);
      return res.status(500).json({ error: 'Failed to read YouTube Analytics last sync' });
    }
  });

  router.post('/performance/youtube/sync', async (req, res) => {
    const fields = ['mode', 'startDate', 'endDate', 'projectId', 'videoId', 'limit'];
    if (!isObjectBody(req.body) || !hasOnlyFields(req.body, fields)) {
      return res.status(400).json({ error: 'invalid YouTube Analytics sync payload' });
    }
    const body = req.body;
    if (
      typeof body.mode !== 'string'
      || typeof body.startDate !== 'string'
      || typeof body.endDate !== 'string'
      || !isOptionalString(body.projectId)
      || !isOptionalString(body.videoId)
      || !isOptionalNumber(body.limit)
    ) {
      return res.status(400).json({ error: 'invalid YouTube Analytics sync payload' });
    }
    try {
      return res.status(200).json(await youtubeSyncService.sync({
        mode: body.mode as 'video' | 'recent' | 'period',
        startDate: body.startDate,
        endDate: body.endDate,
        projectId: body.projectId,
        videoId: body.videoId,
        limit: body.limit,
      }));
    } catch (error) {
      if (error instanceof YouTubePerformanceSyncValidationError) {
        return res.status(400).json({ error: error.message });
      }
      if (error instanceof YouTubeAnalyticsNotConfiguredError) {
        return res.status(503).json({ error: 'YouTube Analytics is not configured', state: 'not_configured' });
      }
      if (error instanceof YouTubeAnalyticsNotAuthorizedError) {
        return res.status(401).json({ error: 'Google authorization is required', state: 'not_authorized' });
      }
      if (error instanceof YouTubeVideoNotFoundError) {
        return res.status(404).json({ error: 'YouTube video not found' });
      }
      if (error instanceof YouTubeAnalyticsQuotaError) {
        return res.status(429).json({ error: 'YouTube Analytics quota is temporarily unavailable' });
      }
      if (error instanceof YouTubeAnalyticsTemporaryError) {
        return res.status(503).json({ error: 'YouTube Analytics is temporarily unavailable' });
      }
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to synchronize YouTube Analytics (${name})`);
      return res.status(500).json({ error: 'Failed to synchronize YouTube Analytics' });
    }
  });

  return router;
};
