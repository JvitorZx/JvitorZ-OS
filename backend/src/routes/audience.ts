import { Router } from 'express';
import { AudienceIntelligenceService } from '../services/audience/AudienceIntelligenceService';
import { AudienceSyncValidationError, YouTubeAudienceSyncService, youtubeAudienceSyncService } from '../services/audience/YouTubeAudienceSyncService';
import { YouTubeAnalyticsNotAuthorizedError, YouTubeAnalyticsNotConfiguredError, YouTubeAnalyticsQuotaError, YouTubeAnalyticsTemporaryError } from '../integrations/youtube/YouTubeAnalyticsErrors';

const id = (value: unknown) => value === undefined || typeof value === 'string' && value.trim().length > 0 && value.length <= 120;
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
export const createAudienceRouter = (sync: YouTubeAudienceSyncService = youtubeAudienceSyncService, intelligence = new AudienceIntelligenceService()): Router => {
  const router = Router();
  router.get('/status', async (_req, res) => { try { return res.status(200).json(await sync.getStatus()); } catch { return res.status(503).json({ code: 'PROVIDER_UNAVAILABLE', error: 'Audience status is temporarily unavailable' }); } });
  router.post('/sync', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !['startDate', 'endDate', 'projectId'].includes(key)) || !date(body.startDate) || !date(body.endDate) || !id(body.projectId)) return res.status(400).json({ code: 'INVALID_REQUEST', error: 'invalid audience sync payload' });
    try { const result = await sync.sync(body); return res.status(200).json(result); }
    catch (error) { if (error instanceof AudienceSyncValidationError) return res.status(400).json({ code: 'INVALID_REQUEST', error: error.message }); if (error instanceof YouTubeAnalyticsNotAuthorizedError) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Google authorization is required' }); if (error instanceof YouTubeAnalyticsNotConfiguredError) return res.status(503).json({ code: 'CONFIG_MISSING', error: 'Audience Analytics is not configured' }); if (error instanceof YouTubeAnalyticsQuotaError) return res.status(429).json({ code: 'RATE_LIMITED', error: 'YouTube Analytics quota is unavailable' }); if (error instanceof YouTubeAnalyticsTemporaryError) return res.status(503).json({ code: 'PROVIDER_UNAVAILABLE', error: 'Audience Analytics is temporarily unavailable' }); return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Failed to synchronize audience data' }); }
  });
  router.get('/summary', async (req, res) => { if (!id(req.query.projectId) || Object.keys(req.query).some((key) => key !== 'projectId')) return res.status(400).json({ code: 'INVALID_REQUEST', error: 'invalid audience query' }); try { return res.status(200).json(await intelligence.summary(req.query.projectId as string | undefined)); } catch { return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Failed to read audience intelligence' }); } });
  router.get('/traffic', async (req, res) => { if (!id(req.query.projectId) || Object.keys(req.query).some((key) => key !== 'projectId')) return res.status(400).json({ code: 'INVALID_REQUEST', error: 'invalid traffic query' }); try { return res.status(200).json(await intelligence.traffic(req.query.projectId as string | undefined)); } catch { return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Failed to read traffic intelligence' }); } });
  router.get('/comparison', async (req, res) => { const allowed = ['projectId','currentStart','currentEnd','previousStart','previousEnd']; if (!id(req.query.projectId) || allowed.slice(1).some((key) => !date(req.query[key])) || Object.keys(req.query).some((key) => !allowed.includes(key))) return res.status(400).json({ code: 'INVALID_REQUEST', error: 'invalid comparison query' }); try { return res.status(200).json(await intelligence.compare({ projectId: req.query.projectId as string | undefined, currentStart: new Date(`${req.query.currentStart}T00:00:00Z`), currentEnd: new Date(`${req.query.currentEnd}T00:00:00Z`), previousStart: new Date(`${req.query.previousStart}T00:00:00Z`), previousEnd: new Date(`${req.query.previousEnd}T00:00:00Z`) })); } catch { return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Failed to compare audience periods' }); } });
  return router;
};
export default createAudienceRouter();
