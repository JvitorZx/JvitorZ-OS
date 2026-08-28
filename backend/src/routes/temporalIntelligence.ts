import { Router, type Response } from 'express';
import { ContentPatternIntelligenceService, SeriesIntelligenceService, SeriesNotFoundError, SeriesSnapshotNotFoundError, SeriesValidationError, TrendIntelligenceService, TrendNotFoundError } from '../services/trend-intelligence';

const objectBody = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const only = (body: Record<string, unknown>, fields: readonly string[]) => Object.keys(body).every((key) => fields.includes(key));
const text = (value: unknown): value is string | undefined => value === undefined || typeof value === 'string';
const safeError = (res: Response, operation: string, error: unknown) => {
  if (error instanceof TrendNotFoundError || error instanceof SeriesNotFoundError || error instanceof SeriesSnapshotNotFoundError) return res.status(404).json({ error: error.message });
  if (error instanceof SeriesValidationError) return res.status(400).json({ error: error.message });
  const name = error instanceof Error ? error.name : 'UnknownError';
  console.error(`${operation} (${name})`);
  return res.status(500).json({ error: 'Temporal intelligence operation failed' });
};

export const createTemporalIntelligenceRouter = (
  trends = new TrendIntelligenceService(),
  series = new SeriesIntelligenceService(),
  patterns = new ContentPatternIntelligenceService(),
): Router => {
  const router = Router();

  router.get('/trends', async (req, res) => {
    const allowed = ['projectId', 'subjectType', 'classification', 'days', 'refresh'];
    if (!Object.keys(req.query).every((key) => allowed.includes(key))) return res.status(400).json({ error: 'invalid trend filters' });
    const days = req.query.days === undefined ? 28 : Number(req.query.days);
    if (![7, 28].includes(days) || Object.values(req.query).some((value) => typeof value !== 'string')) return res.status(400).json({ error: 'invalid trend filters' });
    try {
      return res.status(200).json(await trends.list({
        projectId: typeof req.query.projectId === 'string' ? req.query.projectId : undefined,
        subjectType: typeof req.query.subjectType === 'string' ? req.query.subjectType : undefined,
        classification: typeof req.query.classification === 'string' ? req.query.classification : undefined,
        days: days as 7 | 28, refresh: req.query.refresh !== 'false',
      }));
    } catch (error) { return safeError(res, 'Failed to list trends', error); }
  });

  router.get('/trends/:id', async (req, res) => {
    if (!req.params.id?.trim()) return res.status(400).json({ error: 'trend id is required' });
    try { return res.status(200).json(await trends.getById(req.params.id)); }
    catch (error) { return safeError(res, 'Failed to open trend', error); }
  });

  router.post('/series', async (req, res) => {
    const fields = ['projectId', 'name', 'game', 'topic', 'status', 'metadata'];
    if (!objectBody(req.body) || !only(req.body, fields) || typeof req.body.name !== 'string'
      || !text(req.body.projectId) || !text(req.body.game) || !text(req.body.topic) || !text(req.body.status)
      || (req.body.metadata !== undefined && !objectBody(req.body.metadata))) return res.status(400).json({ error: 'invalid series payload' });
    try {
      const result = await series.create({ projectId: req.body.projectId, name: req.body.name, game: req.body.game,
        topic: req.body.topic, status: req.body.status, metadata: req.body.metadata as Record<string, unknown> | undefined });
      return res.status(result.created ? 201 : 200).json(result.series);
    } catch (error) { return safeError(res, 'Failed to create series', error); }
  });

  router.get('/series', async (req, res) => {
    if (!Object.keys(req.query).every((key) => key === 'projectId') || (req.query.projectId !== undefined && typeof req.query.projectId !== 'string')) return res.status(400).json({ error: 'invalid series filters' });
    try { return res.status(200).json(await series.list(typeof req.query.projectId === 'string' ? req.query.projectId : undefined)); }
    catch (error) { return safeError(res, 'Failed to list series', error); }
  });

  router.get('/series/:id', async (req, res) => {
    if (!req.params.id?.trim()) return res.status(400).json({ error: 'series id is required' });
    try { return res.status(200).json(await series.getById(req.params.id)); }
    catch (error) { return safeError(res, 'Failed to open series', error); }
  });

  router.post('/series/:id/videos', async (req, res) => {
    if (!req.params.id?.trim()) return res.status(400).json({ error: 'series id is required' });
    if (!objectBody(req.body) || !only(req.body, ['snapshotId', 'mode']) || typeof req.body.snapshotId !== 'string'
      || (req.body.mode !== undefined && !['manual', 'auto'].includes(String(req.body.mode)))) return res.status(400).json({ error: 'invalid series video payload' });
    try {
      const result = req.body.mode === 'auto' ? await series.autoAssociate(req.params.id, req.body.snapshotId)
        : await series.linkVideo(req.params.id, req.body.snapshotId);
      if ('linked' in result && !result.linked) return res.status(422).json({ error: result.reason });
      return res.status('created' in result && result.created ? 201 : 200).json(result);
    } catch (error) { return safeError(res, 'Failed to link series video', error); }
  });

  router.delete('/series/:id/videos/:videoId', async (req, res) => {
    if (!req.params.id?.trim() || !req.params.videoId?.trim()) return res.status(400).json({ error: 'series id and video id are required' });
    try { return await series.unlinkVideo(req.params.id, req.params.videoId) ? res.status(204).send() : res.status(404).json({ error: 'Series video link not found' }); }
    catch (error) { return safeError(res, 'Failed to unlink series video', error); }
  });

  router.get('/content-patterns', async (req, res) => {
    if (!Object.keys(req.query).every((key) => ['projectId', 'patternType', 'refresh'].includes(key)) || Object.values(req.query).some((value) => typeof value !== 'string')) return res.status(400).json({ error: 'invalid content pattern filters' });
    try { return res.status(200).json(await patterns.list({ projectId: req.query.projectId as string | undefined,
      patternType: req.query.patternType as string | undefined, refresh: req.query.refresh !== 'false' })); }
    catch (error) { return safeError(res, 'Failed to list content patterns', error); }
  });

  router.get('/subject-performance', async (req, res) => {
    if (!Object.keys(req.query).every((key) => ['projectId', 'type'].includes(key)) || !['game', 'topic'].includes(String(req.query.type))) return res.status(400).json({ error: 'type must be game or topic' });
    try { return res.status(200).json(await patterns.performanceBySubject(String(req.query.type).toUpperCase() as 'GAME' | 'TOPIC', req.query.projectId as string | undefined)); }
    catch (error) { return safeError(res, 'Failed to read subject performance', error); }
  });

  return router;
};

export default createTemporalIntelligenceRouter();
