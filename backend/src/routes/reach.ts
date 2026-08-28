import { Router } from 'express';
import {
  YouTubeReachSyncService,
  youtubeReachSyncService,
  YouTubeReachSyncValidationError,
} from '../services/performance-intelligence/YouTubeReachSyncService';
import {
  YouTubeReachNotAuthorizedError,
  YouTubeReachNotConfiguredError,
  YouTubeReachQuotaError,
  YouTubeReachTemporaryError,
} from '../integrations/youtube/YouTubeReachErrors';

const validOptionalId = (value: unknown): value is string | undefined => (
  value === undefined || (typeof value === 'string' && value.trim().length > 0 && value.length <= 120)
);

export const createReachRouter = (service: YouTubeReachSyncService = youtubeReachSyncService): Router => {
  const router = Router();

  router.get('/youtube/status', async (_req, res) => {
    try { return res.status(200).json(await service.getStatus()); }
    catch { return res.status(503).json({ code: 'PROVIDER_UNAVAILABLE', error: 'Reach status is temporarily unavailable' }); }
  });

  router.get('/data', async (req, res) => {
    if (!validOptionalId(req.query.projectId) || !validOptionalId(req.query.videoId)
      || Object.keys(req.query).some((key) => !['projectId', 'videoId'].includes(key))) {
      return res.status(400).json({ code: 'INVALID_REQUEST', error: 'invalid reach query' });
    }
    try { return res.status(200).json(await service.list(req.query.projectId, req.query.videoId)); }
    catch { return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Failed to read reach data' }); }
  });

  router.get('/quality', async (req, res) => {
    if (!validOptionalId(req.query.projectId) || Object.keys(req.query).some((key) => key !== 'projectId')) {
      return res.status(400).json({ code: 'INVALID_REQUEST', error: 'invalid quality query' });
    }
    try { return res.status(200).json(await service.getQuality(req.query.projectId)); }
    catch { return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Failed to read data quality' }); }
  });

  router.post('/youtube/sync', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !['startDate', 'endDate', 'projectId'].includes(key))
      || typeof body.startDate !== 'string' || typeof body.endDate !== 'string'
      || !validOptionalId(body.projectId)) {
      return res.status(400).json({ code: 'INVALID_REQUEST', error: 'invalid reach sync payload' });
    }
    try {
      const result = await service.sync({ startDate: body.startDate, endDate: body.endDate, projectId: body.projectId });
      return res.status(result.state === 'waiting_for_report' ? 202 : 200).json(result);
    } catch (error) {
      if (error instanceof YouTubeReachSyncValidationError) return res.status(400).json({ code: 'INVALID_REQUEST', error: error.message });
      if (error instanceof YouTubeReachNotAuthorizedError) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Google authorization is required' });
      if (error instanceof YouTubeReachNotConfiguredError) return res.status(503).json({ code: 'CONFIG_MISSING', error: 'YouTube reach is not configured' });
      if (error instanceof YouTubeReachQuotaError) return res.status(429).json({ code: 'RATE_LIMITED', error: 'YouTube Reporting quota is temporarily unavailable' });
      if (error instanceof YouTubeReachTemporaryError) return res.status(503).json({ code: 'PROVIDER_UNAVAILABLE', error: 'YouTube Reporting is temporarily unavailable' });
      return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Failed to synchronize YouTube reach' });
    }
  });

  return router;
};

export default createReachRouter();
