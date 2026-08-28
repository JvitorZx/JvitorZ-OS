import { isGoogleReauthenticationRequired, isGoogleTemporarilyUnavailable } from '../../services/GoogleService';

export class YouTubeReachError extends Error {}
export class YouTubeReachNotConfiguredError extends YouTubeReachError {
  constructor() { super('YouTube reach is not configured'); this.name = 'YouTubeReachNotConfiguredError'; }
}
export class YouTubeReachNotAuthorizedError extends YouTubeReachError {
  constructor() { super('Google authorization is required for YouTube reach'); this.name = 'YouTubeReachNotAuthorizedError'; }
}
export class YouTubeReachQuotaError extends YouTubeReachError {
  constructor() { super('YouTube Reporting quota is temporarily unavailable'); this.name = 'YouTubeReachQuotaError'; }
}
export class YouTubeReachTemporaryError extends YouTubeReachError {
  constructor() { super('YouTube Reporting is temporarily unavailable'); this.name = 'YouTubeReachTemporaryError'; }
}
export class YouTubeReachDataError extends YouTubeReachError {
  constructor() { super('YouTube reach report has an invalid structure'); this.name = 'YouTubeReachDataError'; }
}

export const toSafeYouTubeReachError = (error: unknown): YouTubeReachError => {
  if (error instanceof YouTubeReachError) return error;
  if (isGoogleReauthenticationRequired(error)) return new YouTubeReachNotAuthorizedError();
  const status = (error as { response?: { status?: unknown } })?.response?.status;
  if (status === 401 || status === 403) return new YouTubeReachNotAuthorizedError();
  if (status === 429) return new YouTubeReachQuotaError();
  if (isGoogleTemporarilyUnavailable(error)) return new YouTubeReachTemporaryError();
  return new YouTubeReachTemporaryError();
};
