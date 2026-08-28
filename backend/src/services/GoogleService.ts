import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import type { Credentials, OAuth2Client } from 'google-auth-library';

type GoogleRequestError = {
  name?: unknown;
  code?: unknown;
  response?: {
    status?: unknown;
    data?: {
      error?: unknown;
    };
  };
};

const safeIdentifier = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value)
    ? value
    : undefined;

export const isGoogleReauthenticationRequired = (error: unknown): boolean =>
  (error as GoogleRequestError)?.response?.data?.error === 'invalid_grant';

const transientGoogleCodes = new Set([
  'EACCES', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'ENOTFOUND', 'ETIMEDOUT',
]);

export const isGoogleTemporarilyUnavailable = (error: unknown): boolean => {
  const googleError = error as GoogleRequestError;
  const code = typeof googleError?.code === 'string' ? googleError.code : '';
  const status = googleError?.response?.status;
  return transientGoogleCodes.has(code)
    || (typeof status === 'number' && (status === 429 || status >= 500));
};

export const getSafeGoogleRequestError = (error: unknown): Record<string, unknown> => {
  const googleError = error as GoogleRequestError;
  const status = googleError?.response?.status;

  return {
    error_name: safeIdentifier(googleError?.name) ?? 'UnknownError',
    error_code: safeIdentifier(googleError?.code),
    provider_error: safeIdentifier(googleError?.response?.data?.error),
    http_status: typeof status === 'number' && status >= 100 && status <= 599
      ? status
      : undefined,
  };
};

export class GoogleService {
  constructor(private readonly tokenFilePath = path.resolve(__dirname, '../../google-tokens.json')) {}

  isConfigured(): boolean {
    return Boolean(
      process.env.GOOGLE_CLIENT_ID?.trim()
      && process.env.GOOGLE_CLIENT_SECRET?.trim()
      && process.env.GOOGLE_REDIRECT_URI?.trim(),
    );
  }

  loadTokens(): Credentials | null {
    const tokenFilePath = this.tokenFilePath;

    // Se o arquivo não existe, retornamos null para indicar ausência de tokens
    if (!fs.existsSync(tokenFilePath)) {
      return null;
    }

    try {
      // Lê o conteúdo do arquivo como string
      const rawData = fs.readFileSync(tokenFilePath, { encoding: 'utf-8' });

      // Converte o JSON string em objeto JavaScript
      const tokens = JSON.parse(rawData);
      return tokens && typeof tokens === 'object' ? tokens as Credentials : null;
    } catch {
      return null;
    }
  }

  saveTokens(tokens: Credentials): void {
    const tokenFilePath = this.tokenFilePath;
    const existing = this.loadTokens() ?? {};
    const merged: Credentials = { ...existing, ...tokens };
    const temporaryPath = `${tokenFilePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(merged, null, 2), { encoding: 'utf-8' });
    fs.renameSync(temporaryPath, tokenFilePath);
  }

  getAuthenticationState(): 'NOT_CONFIGURED' | 'AUTH_REQUIRED' | 'CONNECTED' {
    if (!this.isConfigured()) return 'NOT_CONFIGURED';
    const tokens = this.loadTokens();
    if (!tokens) return 'AUTH_REQUIRED';
    if (typeof tokens.refresh_token === 'string' && tokens.refresh_token.length > 0) return 'CONNECTED';
    if (typeof tokens.access_token !== 'string' || tokens.access_token.length === 0) return 'AUTH_REQUIRED';
    return typeof tokens.expiry_date !== 'number' || tokens.expiry_date > Date.now()
      ? 'CONNECTED'
      : 'AUTH_REQUIRED';
  }

  getClient(): OAuth2Client {
    // Lê as variáveis de ambiente que definem as credenciais do OAuth2
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error('Missing Google OAuth configuration in environment variables');
    }

    // Cria o cliente OAuth2 com as credenciais configuradas
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    // Tenta carregar tokens salvos do arquivo
    const tokens = this.loadTokens();

    if (!tokens) {
      throw new Error('User is not authenticated with Google');
    }

    // Configura o cliente OAuth2 com os tokens carregados
    oauth2Client.setCredentials(tokens);
    oauth2Client.on('tokens', (refreshed) => this.saveTokens(refreshed));

    return oauth2Client;
  }

  async refreshAccessToken(): Promise<void> {
    const client = this.getClient();
    await client.getAccessToken();
  }

  isAuthenticated(): boolean {
    return this.getAuthenticationState() === 'CONNECTED';
  }
}
