import { google } from 'googleapis';
import { OAuth2Client, Credentials } from 'google-auth-library';
import { configService } from '../../core/config';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

export default class GoogleAuth {
  private oauth2Client: OAuth2Client;

  constructor() {
    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI!;

    console.log('CLIENT_ID:', process.env.GOOGLE_CLIENT_ID);
    console.log('REDIRECT:', process.env.GOOGLE_REDIRECT_URI);
    console.log('SECRET:', process.env.GOOGLE_CLIENT_SECRET ? 'OK' : 'MISSING');

    this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  initialize(): void {
    // Preparar o cliente OAuth2 para uso futuro
  }

  getAuthUrl(): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
    });
  }

  async getToken(code: string): Promise<Credentials> {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    return tokens;
  }

  setCredentials(tokens: Credentials): void {
    console.log('GoogleAuth.setCredentials called with token keys:', tokens ? Object.keys(tokens) : []);
    this.oauth2Client.setCredentials(tokens);
    console.log('GoogleAuth.oauth2Client.credentials after setCredentials:', this.oauth2Client.credentials);
  }

  getClient(): OAuth2Client {
    return this.oauth2Client;
  }

  isAuthenticated(): boolean {
    return !!this.oauth2Client.credentials.access_token;
  }
}
