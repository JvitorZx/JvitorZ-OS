import { google, type youtubeAnalytics_v2 } from 'googleapis';
import type {
  PerformanceProvider,
  RawVideoPerformanceRecord,
} from '../../domains/performance-intelligence/PerformanceProvider';
import { GoogleService } from '../../services/GoogleService';
import {
  toSafeYouTubeAnalyticsError,
  YouTubeAnalyticsNotAuthorizedError,
  YouTubeAnalyticsNotConfiguredError,
  YouTubeVideoNotFoundError,
} from './YouTubeAnalyticsErrors';
import {
  YouTubeVideoMetadataService,
  type YouTubeVideoMetadataProvider,
} from './YouTubeVideoMetadataService';

export const YOUTUBE_ANALYTICS_SOURCE = 'youtube-analytics';
export const YOUTUBE_ANALYTICS_METRICS = [
  'views',
  'estimatedMinutesWatched',
  'averageViewDuration',
  'averageViewPercentage',
  'subscribersGained',
  'subscribersLost',
  'likes',
  'comments',
] as const;

export interface YouTubeAnalyticsProviderOptions {
  startDate: string;
  endDate: string;
  videoIds?: readonly string[];
  maxResults?: number;
}

type AnalyticsClientFactory = () => youtubeAnalytics_v2.Youtubeanalytics;

const finiteNumberOrNull = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
);

export class YouTubeAnalyticsPerformanceProvider implements PerformanceProvider {
  readonly name = YOUTUBE_ANALYTICS_SOURCE;
  private readonly googleService: GoogleService;
  private readonly metadata: YouTubeVideoMetadataProvider;
  private readonly clientFactory?: AnalyticsClientFactory;

  constructor(
    private readonly options: YouTubeAnalyticsProviderOptions,
    dependencies: {
      googleService?: GoogleService;
      metadata?: YouTubeVideoMetadataProvider;
      clientFactory?: AnalyticsClientFactory;
    } = {},
  ) {
    this.googleService = dependencies.googleService ?? new GoogleService();
    this.metadata = dependencies.metadata ?? new YouTubeVideoMetadataService(this.googleService);
    this.clientFactory = dependencies.clientFactory;
  }

  private getClient(): youtubeAnalytics_v2.Youtubeanalytics {
    if (!this.googleService.isConfigured()) throw new YouTubeAnalyticsNotConfiguredError();
    if (!this.googleService.isAuthenticated()) throw new YouTubeAnalyticsNotAuthorizedError();
    return this.clientFactory?.() ?? google.youtubeAnalytics({
      version: 'v2',
      auth: this.googleService.getClient(),
    });
  }

  async fetch(): Promise<readonly RawVideoPerformanceRecord[]> {
    try {
      const client = this.getClient();
      const videoIds = [...new Set(this.options.videoIds ?? [])];
      const response = await client.reports.query({
        ids: 'channel==MINE',
        startDate: this.options.startDate,
        endDate: this.options.endDate,
        dimensions: 'video',
        metrics: YOUTUBE_ANALYTICS_METRICS.join(','),
        ...(videoIds.length > 0 ? { filters: `video==${videoIds.join(',')}` } : {}),
        sort: '-views',
        maxResults: this.options.maxResults ?? 50,
      });
      const headers = (response.data.columnHeaders ?? []).map(({ name }) => name ?? '');
      const rows = response.data.rows ?? [];
      const rowObjects = rows.map((row) => Object.fromEntries(
        headers.map((header, index) => [header, row[index]]),
      ));
      const returnedVideoIds = rowObjects.flatMap(({ video }) => typeof video === 'string' ? [video] : []);
      const metadata = await this.metadata.getByIds(returnedVideoIds);
      if (videoIds.length === 1 && returnedVideoIds.length === 0) {
        const requested = await this.metadata.getByIds(videoIds);
        if (!requested.has(videoIds[0])) throw new YouTubeVideoNotFoundError();
      }
      const collectedAt = new Date();

      return rowObjects.flatMap((row): RawVideoPerformanceRecord[] => {
        if (typeof row.video !== 'string') return [];
        const video = metadata.get(row.video);
        if (!video) return [];
        return [{
          videoId: row.video,
          title: video.title,
          publishedAt: video.publishedAt,
          durationSeconds: video.durationSeconds,
          periodStart: this.options.startDate,
          periodEnd: this.options.endDate,
          views: finiteNumberOrNull(row.views),
          impressions: null,
          ctr: null,
          averageViewDurationSeconds: finiteNumberOrNull(row.averageViewDuration),
          averageViewPercentage: finiteNumberOrNull(row.averageViewPercentage),
          watchTimeMinutes: finiteNumberOrNull(row.estimatedMinutesWatched),
          subscribersGained: finiteNumberOrNull(row.subscribersGained),
          subscribersLost: finiteNumberOrNull(row.subscribersLost),
          likes: finiteNumberOrNull(row.likes),
          comments: finiteNumberOrNull(row.comments),
          confidence: 1,
          collectedAt,
        }];
      });
    } catch (error) {
      throw toSafeYouTubeAnalyticsError(error);
    }
  }
}
