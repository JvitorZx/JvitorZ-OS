import { isGoogleReauthenticationRequired } from '../../services/GoogleService';

export class YouTubeAnalyticsError extends Error {}

export class YouTubeAnalyticsNotConfiguredError extends YouTubeAnalyticsError {
  constructor() {
    super('YouTube Analytics is not configured');
    this.name = 'YouTubeAnalyticsNotConfiguredError';
  }
}

export class YouTubeAnalyticsNotAuthorizedError extends YouTubeAnalyticsError {
  constructor() {
    super('YouTube Analytics authorization is required');
    this.name = 'YouTubeAnalyticsNotAuthorizedError';
  }
}

export class YouTubeAnalyticsQuotaError extends YouTubeAnalyticsError {
  constructor() {
    super('YouTube Analytics quota is unavailable');
    this.name = 'YouTubeAnalyticsQuotaError';
  }
}

export class YouTubeAnalyticsTemporaryError extends YouTubeAnalyticsError {
  constructor() {
    super('YouTube Analytics is temporarily unavailable');
    this.name = 'YouTubeAnalyticsTemporaryError';
  }
}

export class YouTubeVideoNotFoundError extends YouTubeAnalyticsError {
  constructor() {
    super('YouTube video was not found');
    this.name = 'YouTubeVideoNotFoundError';
  }
}

type GoogleErrorShape = {
  code?: unknown;
  response?: {
    status?: unknown;
    data?: {
      error?: {
        errors?: Array<{ reason?: unknown }>;
      } | unknown;
    };
  };
};

export const toSafeYouTubeAnalyticsError = (error: unknown): YouTubeAnalyticsError => {
  if (error instanceof YouTubeAnalyticsError) return error;
  if (isGoogleReauthenticationRequired(error)) return new YouTubeAnalyticsNotAuthorizedError();

  const googleError = error as GoogleErrorShape;
  const status = googleError.response?.status;
  const code = googleError.code;
  const dataError = googleError.response?.data?.error;
  const errorItems = typeof dataError === 'object' && dataError !== null && 'errors' in dataError
    ? (dataError as { errors?: unknown }).errors
    : undefined;
  const reasons = Array.isArray(errorItems)
    ? errorItems.flatMap((item): string[] => {
      if (typeof item !== 'object' || item === null || !('reason' in item)) return [];
      return typeof item.reason === 'string' ? [item.reason] : [];
    })
    : [];
  const quotaReasons = new Set(['quotaExceeded', 'dailyLimitExceeded', 'userRateLimitExceeded', 'rateLimitExceeded']);

  if (status === 401) return new YouTubeAnalyticsNotAuthorizedError();
  if (status === 429 || reasons.some((reason) => quotaReasons.has(reason))) {
    return new YouTubeAnalyticsQuotaError();
  }
  if (status === 408 || (typeof status === 'number' && status >= 500) || code === 'ETIMEDOUT') {
    return new YouTubeAnalyticsTemporaryError();
  }
  return new YouTubeAnalyticsTemporaryError();
};
