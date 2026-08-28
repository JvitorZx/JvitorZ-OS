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
  'engagedViews',
  'views',
  'estimatedMinutesWatched',
  'averageViewDuration',
  'averageViewPercentage',
  'subscribersGained',
  'subscribersLost',
  'likes',
  'comments',
] as const;

export const classifyCreatorContentType = (value: unknown): 'SHORTS' | 'LONG_FORM' | 'UNKNOWN' => {
  if (value === 'SHORTS' || value === 'shorts') return 'SHORTS';
  if (value === 'VIDEO_ON_DEMAND' || value === 'videoOnDemand') return 'LONG_FORM';
  return 'UNKNOWN';
};

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
      let videoIds = [...new Set(this.options.videoIds ?? [])];
      const query = (ids: readonly string[], includeContentType: boolean) => client.reports.query({
        ids: 'channel==MINE',
        startDate: this.options.startDate,
        endDate: this.options.endDate,
        dimensions: includeContentType ? 'video,creatorContentType' : 'video',
        metrics: YOUTUBE_ANALYTICS_METRICS.join(','),
        ...(ids.length > 0 ? { filters: `video==${ids.join(',')}` } : {}),
        sort: '-views',
        maxResults: this.options.maxResults ?? 50,
      });

      if (videoIds.length === 0) {
        const discovery = await query([], false);
        const discoveryHeaders = (discovery.data.columnHeaders ?? []).map(({ name }) => name ?? '');
        const videoIndex = discoveryHeaders.indexOf('video');
        videoIds = [...new Set((discovery.data.rows ?? []).flatMap((row) => (
          videoIndex >= 0 && typeof row[videoIndex] === 'string' ? [row[videoIndex] as string] : []
        )))];
        if (videoIds.length === 0) return [];
      }

      const response = await query(videoIds, true);
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
          format: classifyCreatorContentType(row.creatorContentType),
          periodStart: this.options.startDate,
          periodEnd: this.options.endDate,
          views: finiteNumberOrNull(row.views),
          engagedViews: finiteNumberOrNull(row.engagedViews),
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
