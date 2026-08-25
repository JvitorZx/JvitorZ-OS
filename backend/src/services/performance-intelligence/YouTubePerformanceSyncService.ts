import type { PerformanceIngestionResult } from './PerformanceIngestionService';
import { DatabaseService } from '../../database/DatabaseService';
import { VideoPerformanceSnapshotRepository } from '../../database/repositories/VideoPerformanceSnapshotRepository';
import { PerformanceSignalRepository } from '../../database/repositories/PerformanceSignalRepository';
import { ChannelInsightRepository } from '../../database/repositories/ChannelInsightRepository';
import { GoogleService } from '../GoogleService';
import { ChannelMemoryService } from '../creator-intelligence/ChannelMemoryService';
import {
  YouTubeAnalyticsPerformanceProvider,
  YOUTUBE_ANALYTICS_SOURCE,
  type YouTubeAnalyticsProviderOptions,
} from '../../integrations/youtube/YouTubeAnalyticsPerformanceProvider';
import {
  YouTubeVideoMetadataService,
  type YouTubeVideoMetadataProvider,
} from '../../integrations/youtube/YouTubeVideoMetadataService';
import {
  YouTubeAnalyticsError,
  YouTubeAnalyticsNotAuthorizedError,
  YouTubeAnalyticsNotConfiguredError,
  YouTubeAnalyticsQuotaError,
  YouTubeAnalyticsTemporaryError,
  YouTubeVideoNotFoundError,
} from '../../integrations/youtube/YouTubeAnalyticsErrors';
import type { PerformanceProvider } from '../../domains/performance-intelligence/PerformanceProvider';
import { PerformanceIngestionService } from './PerformanceIngestionService';

export type YouTubePerformanceSyncMode = 'video' | 'recent' | 'period';

export interface YouTubePerformanceSyncInput {
  mode: YouTubePerformanceSyncMode;
  startDate: string;
  endDate: string;
  projectId?: string | null;
  videoId?: string;
  limit?: number;
}

export type YouTubeAnalyticsConnectionState =
  | 'connected'
  | 'not_authorized'
  | 'temporary_error'
  | 'not_configured'
  | 'synchronized';

export interface YouTubeAnalyticsProviderStatus {
  state: YouTubeAnalyticsConnectionState;
  lastSyncAt: Date | null;
  lastErrorType: 'authorization' | 'quota' | 'temporary' | null;
}

export class YouTubePerformanceSyncValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YouTubePerformanceSyncValidationError';
  }
}

type ProviderFactory = (
  options: YouTubeAnalyticsProviderOptions,
  dependencies: { googleService: GoogleService; metadata: YouTubeVideoMetadataProvider },
) => PerformanceProvider;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const requireDate = (value: string, field: string): string => {
  if (!DATE_PATTERN.test(value)) throw new YouTubePerformanceSyncValidationError(`${field} must use YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new YouTubePerformanceSyncValidationError(`${field} must be a valid date`);
  }
  return value;
};

export class YouTubePerformanceSyncService {
  private readonly googleService: GoogleService;
  private snapshotRepository?: VideoPerformanceSnapshotRepository;
  private ingestionService?: PerformanceIngestionService;
  private channelMemoryService?: ChannelMemoryService;
  private metadataService?: YouTubeVideoMetadataProvider;
  private readonly providerFactory: ProviderFactory;
  private lastErrorType: YouTubeAnalyticsProviderStatus['lastErrorType'] = null;

  constructor(dependencies: {
    googleService?: GoogleService;
    snapshotRepository?: VideoPerformanceSnapshotRepository;
    ingestionService?: PerformanceIngestionService;
    channelMemoryService?: ChannelMemoryService;
    metadataService?: YouTubeVideoMetadataProvider;
    providerFactory?: ProviderFactory;
  } = {}) {
    this.googleService = dependencies.googleService ?? new GoogleService();
    this.snapshotRepository = dependencies.snapshotRepository;
    this.ingestionService = dependencies.ingestionService;
    this.channelMemoryService = dependencies.channelMemoryService;
    this.metadataService = dependencies.metadataService;
    this.providerFactory = dependencies.providerFactory ?? ((options, providerDependencies) => (
      new YouTubeAnalyticsPerformanceProvider(options, providerDependencies)
    ));
  }

  private get snapshots(): VideoPerformanceSnapshotRepository {
    if (!this.snapshotRepository) {
      this.snapshotRepository = new VideoPerformanceSnapshotRepository(DatabaseService.client);
    }
    return this.snapshotRepository;
  }

  private get ingestion(): PerformanceIngestionService {
    if (!this.ingestionService) {
      this.ingestionService = new PerformanceIngestionService(
        this.snapshots,
        new PerformanceSignalRepository(DatabaseService.client),
      );
    }
    return this.ingestionService;
  }

  private get memory(): ChannelMemoryService {
    if (!this.channelMemoryService) {
      this.channelMemoryService = new ChannelMemoryService(
        new ChannelInsightRepository(DatabaseService.client),
        new PerformanceSignalRepository(DatabaseService.client),
        this.snapshots,
      );
    }
    return this.channelMemoryService;
  }

  private get metadata(): YouTubeVideoMetadataProvider {
    if (!this.metadataService) {
      this.metadataService = new YouTubeVideoMetadataService(this.googleService);
    }
    return this.metadataService;
  }

  private validate(input: YouTubePerformanceSyncInput): Required<Pick<
    YouTubePerformanceSyncInput,
    'mode' | 'startDate' | 'endDate' | 'limit'
  >> & Pick<YouTubePerformanceSyncInput, 'projectId' | 'videoId'> {
    if (!['video', 'recent', 'period'].includes(input.mode)) {
      throw new YouTubePerformanceSyncValidationError('mode must be video, recent, or period');
    }
    const startDate = requireDate(input.startDate, 'startDate');
    const endDate = requireDate(input.endDate, 'endDate');
    if (startDate > endDate) {
      throw new YouTubePerformanceSyncValidationError('startDate must not be after endDate');
    }
    const limit = input.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new YouTubePerformanceSyncValidationError('limit must be an integer from 1 to 50');
    }
    const videoId = input.videoId?.trim();
    if (input.mode === 'video' && (!videoId || !VIDEO_ID_PATTERN.test(videoId))) {
      throw new YouTubePerformanceSyncValidationError('videoId is required for video mode');
    }
    if (input.mode !== 'video' && input.videoId !== undefined) {
      throw new YouTubePerformanceSyncValidationError('videoId is only allowed in video mode');
    }
    return { ...input, startDate, endDate, limit, videoId };
  }

  private assertConnection(): void {
    if (!this.googleService.isConfigured()) throw new YouTubeAnalyticsNotConfiguredError();
    if (!this.googleService.isAuthenticated()) throw new YouTubeAnalyticsNotAuthorizedError();
  }

  private emptyResult(): PerformanceIngestionResult {
    return { source: YOUTUBE_ANALYTICS_SOURCE, created: 0, updated: 0, records: [], signals: [] };
  }

  async sync(input: YouTubePerformanceSyncInput): Promise<PerformanceIngestionResult> {
    const validated = this.validate(input);
    this.assertConnection();
    try {
      let videoIds: string[] | undefined;
      if (validated.mode === 'video') videoIds = [validated.videoId as string];
      if (validated.mode === 'recent') {
        videoIds = await this.metadata.listRecentVideoIds(validated.limit);
        if (videoIds.length === 0) {
          this.lastErrorType = null;
          return this.emptyResult();
        }
      }
      const provider = this.providerFactory({
        startDate: validated.startDate,
        endDate: validated.endDate,
        videoIds,
        maxResults: validated.limit,
      }, { googleService: this.googleService, metadata: this.metadata });
      const result = await this.ingestion.ingest(provider, validated.projectId);
      const projectIds = [...new Set(result.records.map(({ projectId }) => projectId))];
      await Promise.all(projectIds.map((projectId) => this.memory.refreshFromSnapshots(projectId)));
      this.lastErrorType = null;
      return result;
    } catch (error) {
      if (error instanceof YouTubeAnalyticsNotAuthorizedError) this.lastErrorType = 'authorization';
      else if (error instanceof YouTubeAnalyticsQuotaError) this.lastErrorType = 'quota';
      else this.lastErrorType = 'temporary';
      throw error;
    }
  }

  async getLastSync(): Promise<{ source: string; lastSyncAt: Date | null }> {
    const latest = await this.snapshots.findLatestBySource(YOUTUBE_ANALYTICS_SOURCE);
    return { source: YOUTUBE_ANALYTICS_SOURCE, lastSyncAt: latest?.collectedAt ?? null };
  }

  async getStatus(): Promise<YouTubeAnalyticsProviderStatus> {
    if (!this.googleService.isConfigured()) {
      return { state: 'not_configured', lastSyncAt: null, lastErrorType: null };
    }
    if (!this.googleService.isAuthenticated()) {
      return { state: 'not_authorized', lastSyncAt: null, lastErrorType: 'authorization' };
    }
    const { lastSyncAt } = await this.getLastSync();
    if (this.lastErrorType) {
      return {
        state: this.lastErrorType === 'authorization' ? 'not_authorized' : 'temporary_error',
        lastSyncAt,
        lastErrorType: this.lastErrorType,
      };
    }
    return { state: lastSyncAt ? 'synchronized' : 'connected', lastSyncAt, lastErrorType: null };
  }
}

export {
  YouTubeAnalyticsError,
  YouTubeAnalyticsNotAuthorizedError,
  YouTubeAnalyticsNotConfiguredError,
  YouTubeAnalyticsQuotaError,
  YouTubeAnalyticsTemporaryError,
  YouTubeVideoNotFoundError,
};
