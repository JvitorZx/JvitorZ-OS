import { Router } from 'express';
import ChannelService from '../integrations/youtube/ChannelService';
import {
  getSafeGoogleRequestError,
  GoogleService,
  isGoogleReauthenticationRequired,
  isGoogleTemporarilyUnavailable,
} from '../services/GoogleService';
import { ChannelDataService } from '../services/ChannelDataService';

type YouTubeRouteDependencies = {
  googleService: Pick<GoogleService, 'isAuthenticated'>;
  createChannelService: () => Pick<ChannelService, 'getChannelInfo'>;
  channelDataService: Pick<ChannelDataService, 'getChannel'>;
};

export const createYouTubeRouter = (dependencies: Partial<YouTubeRouteDependencies> = {}): Router => {
  const googleService = dependencies.googleService ?? new GoogleService();
  const createChannelService = dependencies.createChannelService ?? (() => new ChannelService());
  const channelDataService = dependencies.channelDataService ?? new ChannelDataService();
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
  return router;
};

export default createYouTubeRouter();
