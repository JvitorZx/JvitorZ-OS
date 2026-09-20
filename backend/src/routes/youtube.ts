import { Router } from 'express';
import ChannelService from '../integrations/youtube/ChannelService';
import {
  getSafeGoogleRequestError,
  GoogleService,
  isGoogleReauthenticationRequired,
  isGoogleTemporarilyUnavailable,
} from '../services/GoogleService';
import { ChannelDataService } from '../services/ChannelDataService';
import { ChannelContentService, ChannelContentValidationError, ChannelVideoNotFoundError } from '../services/ChannelContentService';

type YouTubeRouteDependencies = {
  googleService: Pick<GoogleService, 'isAuthenticated'>;
  createChannelService: () => Pick<ChannelService, 'getChannelInfo'>;
  channelDataService: Pick<ChannelDataService, 'getChannel'>;
  channelContentService: Pick<ChannelContentService, 'listRecent' | 'listPage' | 'getVideo' | 'getSummary'>;
};

export const createYouTubeRouter = (dependencies: Partial<YouTubeRouteDependencies> = {}): Router => {
  const googleService = dependencies.googleService ?? new GoogleService();
  const createChannelService = dependencies.createChannelService ?? (() => new ChannelService());
  const channelDataService = dependencies.channelDataService ?? new ChannelDataService();
  const channelContentService = dependencies.channelContentService ?? new ChannelContentService();
  const legacyDependencies = Boolean(dependencies.googleService || dependencies.createChannelService);
  const router = Router();
  router.get('/channel', async (_req, res) => {
    if (!legacyDependencies) {
      try {
        const channel = await channelDataService.getChannel();
        if (channel.id) return res.status(200).json(channel);
        if (channel.integration.state === 'AUTH_REQUIRED') {
          return res.status(401).json({ code: 'AUTH_REQUIRED', error: channel.integration.summary });
        }
        if (channel.integration.state === 'NOT_CONFIGURED') {
          return res.status(503).json({ code: 'CONFIG_MISSING', error: channel.integration.summary });
        }
        return res.status(503).json({ code: 'PROVIDER_UNAVAILABLE', error: channel.integration.summary });
      } catch (error) {
        const name = error instanceof Error ? error.name : 'UnknownError';
        console.error(`Failed to read persisted channel state (${name})`);
        return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Failed to fetch channel information' });
      }
    }

    if (!googleService.isAuthenticated()) {
      console.log('Google OAuth not authenticated at route /api/youtube/channel');
      return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Google OAuth not authenticated' });
    }

    try {
      const channelInfo = await createChannelService().getChannelInfo();
      return res.json(channelInfo);
    } catch (error) {
      const safeError = getSafeGoogleRequestError(error);

      if (isGoogleReauthenticationRequired(error)) {
        console.warn('Google OAuth reauthentication required at route /api/youtube/channel', safeError);
        return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Google OAuth not authenticated' });
      }
      if (isGoogleTemporarilyUnavailable(error)) {
        console.warn('Google temporarily unavailable at route /api/youtube/channel', safeError);
        return res.status(503).json({ code: 'PROVIDER_UNAVAILABLE', error: 'YouTube temporarily unavailable' });
      }

      console.error('Google request failed at route /api/youtube/channel', safeError);
      return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Failed to fetch channel information' });
    }
  });
  router.post('/channel/sync', async (_req, res) => {
    try {
      const channel = await channelDataService.getChannel({ refresh: true });
      if (channel.id && channel.integration.state === 'CONNECTED') return res.status(200).json(channel);
      if (channel.integration.state === 'AUTH_REQUIRED' || (channel.integration.stale && !googleService.isAuthenticated())) {
        return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Google authorization is required' });
      }
      if (channel.integration.state === 'NOT_CONFIGURED') {
        return res.status(503).json({ code: 'CONFIG_MISSING', error: 'Google integration is not configured' });
      }
      return res.status(503).json({ code: 'PROVIDER_UNAVAILABLE', error: 'YouTube is temporarily unavailable' });
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to synchronize channel data (${name})`);
      return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Failed to synchronize channel information' });
    }
  });
  router.get('/videos', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const rawLimit = req.query.limit;
    const limit = rawLimit === undefined ? 12 : Number(rawLimit);
    try {
      return res.status(200).json(await channelContentService.listRecent(limit));
    } catch (error) {
      if (error instanceof ChannelContentValidationError) {
        return res.status(400).json({ code: 'INVALID_REQUEST', error: error.message });
      }
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to list persisted channel videos (${name})`);
      return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Failed to list channel videos' });
    }
  });
  router.get('/videos-summary', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try { return res.status(200).json(await channelContentService.getSummary()); }
    catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to summarize persisted channel videos (${name})`);
      return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Failed to summarize channel videos' });
    }
  });
  router.get('/videos-page', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const page = req.query.page === undefined ? 1 : Number(req.query.page);
      const pageSize = req.query.pageSize === undefined ? 12 : Number(req.query.pageSize);
      return res.status(200).json(await channelContentService.listPage(page, pageSize));
    } catch (error) {
      if (error instanceof ChannelContentValidationError) return res.status(400).json({ code: 'INVALID_REQUEST', error: error.message });
      const name = error instanceof Error ? error.name : 'UnknownError'; console.error(`Failed to page persisted channel videos (${name})`);
      return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Failed to page channel videos' });
    }
  });
  router.get('/videos/:videoId', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      return res.status(200).json(await channelContentService.getVideo(req.params.videoId));
    } catch (error) {
      if (error instanceof ChannelContentValidationError) return res.status(400).json({ code: 'INVALID_REQUEST', error: error.message });
      if (error instanceof ChannelVideoNotFoundError) return res.status(404).json({ code: 'NO_DATA', error: 'Video not found' });
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to open persisted channel video (${name})`);
      return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Failed to open channel video' });
    }
  });
  return router;
};

export default createYouTubeRouter();
