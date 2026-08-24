import { Router } from 'express';
import ChannelService from '../integrations/youtube/ChannelService';
import {
  getSafeGoogleRequestError,
  GoogleService,
  isGoogleReauthenticationRequired,
} from '../services/GoogleService';

const router = Router();
const googleService = new GoogleService();

router.get('/channel', async (_req, res) => {
  if (!googleService.isAuthenticated()) {
    console.log('Google OAuth not authenticated at route /api/youtube/channel');
    return res.status(401).json({ error: 'Google OAuth not authenticated' });
  }

  try {
    const channelService = new ChannelService();
    const channelInfo = await channelService.getChannelInfo();
    return res.json(channelInfo);
  } catch (error) {
    const safeError = getSafeGoogleRequestError(error);

    if (isGoogleReauthenticationRequired(error)) {
      console.warn('Google OAuth reauthentication required at route /api/youtube/channel', safeError);
      return res.status(401).json({ error: 'Google OAuth not authenticated' });
    }

    console.error('Google request failed at route /api/youtube/channel', safeError);
    return res.status(500).json({ error: 'Failed to fetch channel information' });
  }
});

export default router;
