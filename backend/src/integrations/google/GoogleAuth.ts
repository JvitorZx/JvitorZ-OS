import { google } from 'googleapis';
import { OAuth2Client, Credentials } from 'google-auth-library';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

export default class GoogleAuth {
  private oauth2Client: OAuth2Client;
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor() {
    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI!;

    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;

    console.log('CLIENT_ID:', process.env.GOOGLE_CLIENT_ID);
    console.log('REDIRECT:', process.env.GOOGLE_REDIRECT_URI);
    console.log('SECRET:', process.env.GOOGLE_CLIENT_SECRET ? 'OK' : 'MISSING');

    this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  private getMaskedClientSecret(): string {
    if (!this.clientSecret) {
      return 'MISSING';
    }

    return `${this.clientSecret.slice(0, 8)}...${this.clientSecret.slice(-4)} (length=${this.clientSecret.length})`;
  }

  private getEffectiveTokenRequestConfig(code: string): Record<string, unknown> {
    return {
      code_present: Boolean(code),
      code_length: code.length,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      client_secret: this.getMaskedClientSecret(),
    };
  }

  private getGoogleErrorResponse(error: unknown): Record<string, unknown> | undefined {
    const response = (error as { response?: unknown }).response as
      | {
          data?: unknown;
          status?: number;
          statusText?: string;
          headers?: unknown;
        }
      | undefined;

    if (!response) {
      return undefined;
    }

    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data: response.data,
    };
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
    const effectiveConfig = this.getEffectiveTokenRequestConfig(code);

    console.log('Google OAuth getToken before request:', effectiveConfig);

    try {
      const { tokens } = await this.oauth2Client.getToken(code);

      console.log('Google OAuth getToken success:', {
        token_keys: Object.keys(tokens),
        has_access_token: Boolean(tokens.access_token),
        has_refresh_token: Boolean(tokens.refresh_token),
        token_type: tokens.token_type,
        expiry_date: tokens.expiry_date,
        scope: tokens.scope,
        effective_config: effectiveConfig,
      });

      this.oauth2Client.setCredentials(tokens);
      return tokens;
    } catch (error) {
      const oauthError = error as {
        message?: string;
        code?: string;
        stack?: string;
      };

      console.error('Google OAuth getToken error details:', {
        google_response: this.getGoogleErrorResponse(error),
        message: oauthError.message,
        code: oauthError.code,
        stack: oauthError.stack,
        effective_config: effectiveConfig,
      });

      throw error;
    }
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
