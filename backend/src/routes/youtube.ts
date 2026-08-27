import { Router } from 'express';
import ChannelService from '../integrations/youtube/ChannelService';
import {
  getSafeGoogleRequestError,
  GoogleService,
  isGoogleReauthenticationRequired,
  isGoogleTemporarilyUnavailable,
} from '../services/GoogleService';

type YouTubeRouteDependencies = {
  googleService: Pick<GoogleService, 'isAuthenticated'>;
  createChannelService: () => Pick<ChannelService, 'getChannelInfo'>;
};

export const createYouTubeRouter = ({
  googleService = new GoogleService(),
  createChannelService = () => new ChannelService(),
}: Partial<YouTubeRouteDependencies> = {}): Router => {
  const router = Router();
  router.get('/channel', async (_req, res) => {
    if (!googleService.isAuthenticated()) {
      console.log('Google OAuth not authenticated at route /api/youtube/channel');
      return res.status(401).json({ error: 'Google OAuth not authenticated' });
    }

    try {
      const channelInfo = await createChannelService().getChannelInfo();
      return res.json(channelInfo);
    } catch (error) {
      const safeError = getSafeGoogleRequestError(error);

      if (isGoogleReauthenticationRequired(error)) {
        console.warn('Google OAuth reauthentication required at route /api/youtube/channel', safeError);
        return res.status(401).json({ error: 'Google OAuth not authenticated' });
      }
      if (isGoogleTemporarilyUnavailable(error)) {
        console.warn('Google temporarily unavailable at route /api/youtube/channel', safeError);
        return res.status(503).json({ error: 'YouTube temporarily unavailable' });
      }

      console.error('Google request failed at route /api/youtube/channel', safeError);
      return res.status(500).json({ error: 'Failed to fetch channel information' });
    }
  });
  return router;
};

export default createYouTubeRouter();
