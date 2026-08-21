import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import GoogleAuth from '../integrations/google/GoogleAuth';
import { OAuthStateStore } from '../integrations/google/OAuthStateStore';

const router = Router();
const tokenFile = path.resolve(__dirname, '../../google-tokens.json');
const oauthStateStore = new OAuthStateStore();

const getGoogleAuth = (): GoogleAuth => new GoogleAuth();
const getSafeErrorName = (error: unknown): string => {
  const name = (error as { name?: unknown })?.name;

  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) ? name : 'UnknownError';
};

router.get('/google', (_req, res) => {
  const googleAuth = getGoogleAuth();
  const state = oauthStateStore.create();
  const authUrl = googleAuth.getAuthUrl(state);
  console.log('Google OAuth authorization redirect started', { stage: 'authorization_redirect' });
  return res.redirect(authUrl);
});

router.get('/google/callback', async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;

  if (!state) {
    console.warn('Google OAuth state validation failed', {
      stage: 'state_validation',
      reason: 'missing',
    });
    return res.status(400).json({ error: 'Invalid or expired OAuth state' });
  }

  const stateValidation = oauthStateStore.consume(state);

  if (stateValidation !== 'valid') {
    console.warn('Google OAuth state validation failed', {
      stage: 'state_validation',
      reason: stateValidation,
    });
    return res.status(400).json({ error: 'Invalid or expired OAuth state' });
  }

  const code = typeof req.query.code === 'string' ? req.query.code : undefined;

  if (!code) {
    return res.status(400).json({ error: 'Authorization code not found' });
  }

  try {
    const googleAuth = getGoogleAuth();
    const tokens = await googleAuth.getToken(code);
    fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2), { encoding: 'utf-8' });
    console.log('Google OAuth callback completed', { stage: 'callback' });
    return res.json({ message: 'Google authentication completed successfully.' });
  } catch (error) {
    console.error('Google OAuth callback failed', {
      stage: 'callback',
      error_name: getSafeErrorName(error),
    });
    return res.status(500).json({ error: 'Failed to exchange code for token' });
  }
});

export default router;
