import { google, type youtubeAnalytics_v2 } from 'googleapis';
import { GoogleService } from '../../services/GoogleService';
import { classifyCreatorContentType } from './YouTubeAnalyticsPerformanceProvider';
import {
  toSafeYouTubeAnalyticsError,
  YouTubeAnalyticsNotAuthorizedError,
  YouTubeAnalyticsNotConfiguredError,
  YouTubeAnalyticsQuotaError,
} from './YouTubeAnalyticsErrors';

export const YOUTUBE_AUDIENCE_SOURCE = 'youtube-analytics-audience';
export const AUDIENCE_DIMENSIONS = ['traffic_source', 'search_term', 'country', 'device_type', 'subscribed_status'] as const;
export type AudienceDimension = typeof AUDIENCE_DIMENSIONS[number];

export interface RawAudienceRecord {
  dimension: AudienceDimension;
  segment: string;
  format: 'SHORTS' | 'LONG_FORM' | 'UNKNOWN';
  periodStart: string;
  periodEnd: string;
  views: number | null;
  engagedViews: number | null;
  watchTimeMinutes: number | null;
  averageViewDurationSeconds: number | null;
  averageViewPercentage: number | null;
  collectedAt: Date;
}

export interface YouTubeAudienceFetchResult {
  records: RawAudienceRecord[];
  availableDimensions: AudienceDimension[];
  missingDimensions: AudienceDimension[];
}

export interface YouTubeAudienceProvider { fetch(input: { startDate: string; endDate: string }): Promise<YouTubeAudienceFetchResult>; }

type AnalyticsClient = youtubeAnalytics_v2.Youtubeanalytics;
type Query = youtubeAnalytics_v2.Params$Resource$Reports$Query;
const numberOrNull = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const nextDate = (value: string): string => { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); };

const SPECS: ReadonlyArray<{ dimension: AudienceDimension; apiDimension: string; metrics: string; filters?: string; sort?: string; maxResults?: number }> = [
  { dimension: 'traffic_source', apiDimension: 'insightTrafficSourceType,creatorContentType', metrics: 'engagedViews,views,estimatedMinutesWatched' },
  { dimension: 'search_term', apiDimension: 'insightTrafficSourceDetail,creatorContentType', metrics: 'engagedViews,views,estimatedMinutesWatched', filters: 'insightTrafficSourceType==YT_SEARCH', sort: '-views', maxResults: 25 },
  { dimension: 'country', apiDimension: 'country,creatorContentType', metrics: 'engagedViews,views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage' },
  { dimension: 'device_type', apiDimension: 'deviceType,creatorContentType', metrics: 'engagedViews,views,estimatedMinutesWatched' },
  { dimension: 'subscribed_status', apiDimension: 'subscribedStatus,creatorContentType', metrics: 'engagedViews,views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage' },
];

export class GoogleYouTubeAudienceProvider implements YouTubeAudienceProvider {
  constructor(private readonly options: { googleService?: GoogleService; clientFactory?: () => AnalyticsClient } = {}) {}

  async fetch(input: { startDate: string; endDate: string }): Promise<YouTubeAudienceFetchResult> {
    const googleService = this.options.googleService ?? new GoogleService();
    if (!googleService.isConfigured()) throw new YouTubeAnalyticsNotConfiguredError();
    if (!googleService.isAuthenticated()) throw new YouTubeAnalyticsNotAuthorizedError();
    const client = this.options.clientFactory?.() ?? google.youtubeAnalytics({ version: 'v2', auth: googleService.getClient() });
    const records: RawAudienceRecord[] = [];
    const availableDimensions: AudienceDimension[] = [];
    const missingDimensions: AudienceDimension[] = [];
    const collectedAt = new Date();

    for (const spec of SPECS) {
      try {
        const request: Query = { ids: 'channel==MINE', startDate: input.startDate, endDate: input.endDate, dimensions: spec.apiDimension, metrics: spec.metrics, ...(spec.filters ? { filters: spec.filters } : {}), ...(spec.sort ? { sort: spec.sort } : {}), maxResults: spec.maxResults ?? 200 };
        const response = await client.reports.query(request);
        const headers = (response.data.columnHeaders ?? []).map(({ name }) => name ?? '');
        const rows = response.data.rows ?? [];
        if (rows.length === 0) { missingDimensions.push(spec.dimension); continue; }
        const segmentHeader = spec.apiDimension.split(',')[0];
        for (const row of rows) {
          const value = Object.fromEntries(headers.map((header, index) => [header, row[index]]));
          const segment = value[segmentHeader];
          if (typeof segment !== 'string' || !segment.trim()) continue;
          records.push({
            dimension: spec.dimension, segment: segment.trim(), format: classifyCreatorContentType(value.creatorContentType),
            periodStart: input.startDate, periodEnd: nextDate(input.endDate),
            views: numberOrNull(value.views), engagedViews: numberOrNull(value.engagedViews), watchTimeMinutes: numberOrNull(value.estimatedMinutesWatched),
            averageViewDurationSeconds: numberOrNull(value.averageViewDuration), averageViewPercentage: numberOrNull(value.averageViewPercentage), collectedAt,
          });
        }
        if (records.some(({ dimension }) => dimension === spec.dimension)) availableDimensions.push(spec.dimension); else missingDimensions.push(spec.dimension);
      } catch (error) {
        const status = (error as { response?: { status?: unknown } })?.response?.status;
        const safe = toSafeYouTubeAnalyticsError(error);
        if (safe instanceof YouTubeAnalyticsNotAuthorizedError || safe instanceof YouTubeAnalyticsQuotaError) throw safe;
        if (status === 400 || status === 403 || typeof status === 'number' && status >= 500) { missingDimensions.push(spec.dimension); continue; }
        throw safe;
      }
    }
    return { records, availableDimensions: [...new Set(availableDimensions)], missingDimensions: [...new Set(missingDimensions)] };
  }
}
