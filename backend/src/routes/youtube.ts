import { Router } from 'express';
import GoogleAuth from '../integrations/google/GoogleAuth';
import ChannelService from '../integrations/youtube/ChannelService';

const router = Router();
const googleAuth = new GoogleAuth();
const channelService = new ChannelService();

router.get('/channel', async (_req, res) => {
  if (!googleAuth.isAuthenticated()) {
    console.log('Google OAuth not authenticated at route /api/youtube/channel');
    console.log('GoogleAuth client credentials before failure:', googleAuth.getClient().credentials);
    console.log('Non-authenticated check stack:', new Error('Auth failure stack').stack);
    return res.status(401).json({ error: 'Google OAuth not authenticated' });
  }

  try {
    const channelInfo = await channelService.getChannelInfo();
    return res.json(channelInfo);
  } catch (error) {
    console.error('Error fetching channel info:', error);
    return res.status(500).json({ error: 'Failed to fetch channel information' });
  }
});

export default router;
