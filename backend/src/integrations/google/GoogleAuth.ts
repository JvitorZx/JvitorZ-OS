import { google } from 'googleapis';
import { OAuth2Client, Credentials } from 'google-auth-library';

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

    this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  private getSafeErrorDetails(error: unknown): Record<string, unknown> {
    const oauthError = error as {
      name?: unknown;
      code?: unknown;
      response?: {
        status?: unknown;
        data?: { error?: unknown };
      };
    };
    const safeIdentifier = (value: unknown): string | undefined =>
      typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value) ? value : undefined;
    const status = oauthError?.response?.status;

    return {
      stage: 'token_exchange',
      error_name: safeIdentifier(oauthError?.name) ?? 'UnknownError',
      error_code: safeIdentifier(oauthError?.code),
      http_status: typeof status === 'number' && status >= 100 && status <= 599 ? status : undefined,
      provider_error: safeIdentifier(oauthError?.response?.data?.error),
    };
  }

  initialize(): void {
    // Preparar o cliente OAuth2 para uso futuro
  }

  getAuthUrl(state: string): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      state,
    });
  }

  async getToken(code: string): Promise<Credentials> {
    console.log('Google OAuth token exchange started', { stage: 'token_exchange' });

    try {
      const { tokens } = await this.oauth2Client.getToken(code);

      this.oauth2Client.setCredentials(tokens);
      console.log('Google OAuth token exchange completed', { stage: 'token_exchange' });
      return tokens;
    } catch (error) {
      console.error('Google OAuth token exchange failed', this.getSafeErrorDetails(error));
      throw error;
    }
  }

  setCredentials(tokens: Credentials): void {
    this.oauth2Client.setCredentials(tokens);
  }

  getClient(): OAuth2Client {
    return this.oauth2Client;
  }

  isAuthenticated(): boolean {
    return !!this.oauth2Client.credentials.access_token;
  }
}
