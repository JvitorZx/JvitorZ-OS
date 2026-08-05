import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import GoogleAuth from '../integrations/google/GoogleAuth';

const router = Router();
const tokenFile = path.resolve(__dirname, '../../google-tokens.json');

const getGoogleAuth = (): GoogleAuth => new GoogleAuth();

router.get('/google', (_req, res) => {
  const googleAuth = getGoogleAuth();
  const authUrl = googleAuth.getAuthUrl();
  console.log('Google OAuth URL:', authUrl);
  return res.redirect(authUrl);
});

router.get('/google/callback', async (req, res) => {
  const code = req.query.code as string | undefined;

  if (!code) {
    return res.status(400).json({ error: 'Authorization code not found' });
  }

  try {
    const googleAuth = getGoogleAuth();
    const tokens = await googleAuth.getToken(code);
    console.log('Auth callback __dirname:', __dirname);
    console.log('Auth callback process.cwd():', process.cwd());
    console.log('Auth callback tokenFile:', tokenFile);
    console.log('Auth callback resolved tokenFile:', path.resolve(__dirname, '../../google-tokens.json'));
    console.log('Google OAuth tokens received properties:', Object.keys(tokens));
    console.log('Token file path:', tokenFile);
    fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2), { encoding: 'utf-8' });
    console.log('Token file written:', fs.existsSync(tokenFile));
    return res.json({ message: 'Google authentication completed successfully.' });
  } catch (error) {
    console.error('Error exchanging code for token:', error);
    return res.status(500).json({ error: 'Failed to exchange code for token' });
  }
});

export default router;
