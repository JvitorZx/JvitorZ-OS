import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

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
  loadTokens(): Record<string, unknown> | null {
    // Define o caminho do arquivo google-tokens.json a partir da raiz do backend
    const tokenFilePath = path.resolve(__dirname, '../../google-tokens.json');

    // Se o arquivo não existe, retornamos null para indicar ausência de tokens
    if (!fs.existsSync(tokenFilePath)) {
      return null;
    }

    try {
      // Lê o conteúdo do arquivo como string
      const rawData = fs.readFileSync(tokenFilePath, { encoding: 'utf-8' });

      // Converte o JSON string em objeto JavaScript
      const tokens = JSON.parse(rawData);

      // Retorna o objeto de tokens lido do arquivo
      return tokens;
    } catch (error) {
      // Se ocorrer qualquer erro na leitura ou parse, retorna null sem lançar
      return null;
    }
  }

  saveTokens(): void {
    // TODO: implementar salvamento de tokens
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

    return oauth2Client;
  }

  refreshAccessToken(): void {
    // TODO: implementar refresh do token de acesso
  }

  isAuthenticated(): boolean {
    // Tenta carregar os tokens do armazenamento local
    const tokens = this.loadTokens();

    // Se não existirem tokens salvos, não estamos autenticados
    if (!tokens) {
      return false;
    }

    // Verifica se o token contém um access_token válido
    const accessToken = tokens['access_token'];

    // Retorna true somente se houver um access_token presente
    return typeof accessToken === 'string' && accessToken.length > 0;
  }
}
