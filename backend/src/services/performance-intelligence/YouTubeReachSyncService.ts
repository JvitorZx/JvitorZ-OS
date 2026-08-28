import { createHash } from 'crypto';
import type { Prisma, VideoReachSnapshot } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { ReachSyncStateRepository } from '../../database/repositories/ReachSyncStateRepository';
import { VideoPerformanceSnapshotRepository } from '../../database/repositories/VideoPerformanceSnapshotRepository';
import { VideoReachSnapshotRepository } from '../../database/repositories/VideoReachSnapshotRepository';
import { DataQualityService, type DataQualityReport } from '../../domains/data-quality/DataQualityService';
import { classifyFreshness } from '../../domains/data-quality/FreshnessPolicy';
import {
  GoogleYouTubeReachProvider,
  YOUTUBE_REACH_REPORT_TYPE,
  YOUTUBE_REACH_SOURCE,
  type YouTubeReachProvider,
} from '../../integrations/youtube/YouTubeReachProvider';
import {
  YouTubeReachNotAuthorizedError,
  YouTubeReachNotConfiguredError,
  YouTubeReachQuotaError,
  YouTubeReachTemporaryError,
} from '../../integrations/youtube/YouTubeReachErrors';
import { GoogleService } from '../GoogleService';

export type YouTubeReachConnectionState =
  | 'not_configured'
  | 'not_authorized'
  | 'waiting_for_report'
  | 'synchronized'
  | 'temporary_error';

export interface YouTubeReachStatus {
  state: YouTubeReachConnectionState;
  reportTypeId: string;
  jobId: string | null;
  lastReportAt: Date | null;
  lastSyncAt: Date | null;
  lastErrorType: 'authorization' | 'quota' | 'temporary' | null;
  quality: DataQualityReport;
}

export interface YouTubeReachSyncInput {
  startDate: string;
  endDate: string;
  projectId?: string | null;
}

export interface YouTubeReachSyncResult {
  state: 'waiting_for_report' | 'synchronized';
  source: typeof YOUTUBE_REACH_SOURCE;
  jobId: string;
  jobCreated: boolean;
  reportsProcessed: number;
  created: number;
  updated: number;
  records: VideoReachSnapshot[];
  quality: DataQualityReport;
}

export class YouTubeReachSyncValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'YouTubeReachSyncValidationError'; }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const requireDate = (value: string, field: string): string => {
  if (!DATE_PATTERN.test(value)) throw new YouTubeReachSyncValidationError(`${field} must use YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new YouTubeReachSyncValidationError(`${field} must be a valid date`);
  }
  return value;
};
const date = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const key = (parts: readonly (string | null)[]): string => createHash('sha256').update(parts.join('|')).digest('hex');

export class YouTubeReachSyncService {
  private readonly google: GoogleService;
  private readonly provider: YouTubeReachProvider;
  private readonly reach: VideoReachSnapshotRepository;
  private readonly performance: VideoPerformanceSnapshotRepository;
  private readonly states: ReachSyncStateRepository;
  private readonly qualityService: DataQualityService;

  constructor(dependencies: {
    googleService?: GoogleService;
    provider?: YouTubeReachProvider;
    reachRepository?: VideoReachSnapshotRepository;
    performanceRepository?: VideoPerformanceSnapshotRepository;
    stateRepository?: ReachSyncStateRepository;
    qualityService?: DataQualityService;
  } = {}) {
    this.google = dependencies.googleService ?? new GoogleService();
    this.provider = dependencies.provider ?? new GoogleYouTubeReachProvider({ googleService: this.google });
    this.reach = dependencies.reachRepository ?? new VideoReachSnapshotRepository(DatabaseService.client);
    this.performance = dependencies.performanceRepository ?? new VideoPerformanceSnapshotRepository(DatabaseService.client);
    this.states = dependencies.stateRepository ?? new ReachSyncStateRepository(DatabaseService.client);
    this.qualityService = dependencies.qualityService ?? new DataQualityService();
  }

  private validate(input: YouTubeReachSyncInput): Required<Pick<YouTubeReachSyncInput, 'startDate' | 'endDate'>> & Pick<YouTubeReachSyncInput, 'projectId'> {
    const startDate = requireDate(input.startDate, 'startDate');
    const endDate = requireDate(input.endDate, 'endDate');
    if (startDate > endDate) throw new YouTubeReachSyncValidationError('startDate must not be after endDate');
    const days = (date(endDate).getTime() - date(startDate).getTime()) / 86_400_000 + 1;
    if (days > 31) throw new YouTubeReachSyncValidationError('reach sync accepts at most 31 days');
    const projectId = input.projectId?.trim() || null;
    return { startDate, endDate, projectId };
  }

  private async knownVideoIds(projectId: string | null): Promise<Set<string>> {
    return new Set((await this.performance.findAll({ projectId })).map(({ videoId }) => videoId));
  }

  async list(projectId?: string | null, videoId?: string): Promise<VideoReachSnapshot[]> {
    return this.reach.findAll({ projectId: projectId?.trim() || null, ...(videoId ? { videoId: videoId.trim() } : {}) });
  }

  async getQuality(projectId?: string | null): Promise<DataQualityReport> {
    const normalized = projectId?.trim() || null;
    const records = await this.reach.findAll({ projectId: normalized, source: YOUTUBE_REACH_SOURCE });
    return this.qualityService.evaluateReach(records, { knownVideoIds: await this.knownVideoIds(normalized) });
  }

  async getStatus(): Promise<YouTubeReachStatus> {
    const quality = await this.getQuality();
    const saved = await this.states.find(YOUTUBE_REACH_SOURCE);
    if (!this.google.isConfigured()) return { state: 'not_configured', reportTypeId: YOUTUBE_REACH_REPORT_TYPE, jobId: saved?.jobId ?? null, lastReportAt: saved?.lastReportAt ?? null, lastSyncAt: saved?.lastSyncAt ?? null, lastErrorType: null, quality };
    if (!this.google.isAuthenticated()) return { state: 'not_authorized', reportTypeId: YOUTUBE_REACH_REPORT_TYPE, jobId: saved?.jobId ?? null, lastReportAt: saved?.lastReportAt ?? null, lastSyncAt: saved?.lastSyncAt ?? null, lastErrorType: 'authorization', quality };
    return {
      state: (saved?.state as YouTubeReachConnectionState | undefined) ?? (quality.sampleSize ? 'synchronized' : 'waiting_for_report'),
      reportTypeId: YOUTUBE_REACH_REPORT_TYPE,
      jobId: saved?.jobId ?? null,
      lastReportAt: saved?.lastReportAt ?? quality.latestPeriodEnd,
      lastSyncAt: saved?.lastSyncAt ?? quality.latestCollectedAt,
      lastErrorType: saved?.lastErrorType as YouTubeReachStatus['lastErrorType'] ?? null,
      quality,
    };
  }

  async sync(input: YouTubeReachSyncInput): Promise<YouTubeReachSyncResult> {
    const validated = this.validate(input);
    try {
      const fetched = await this.provider.fetch(validated);
      const knownVideoIds = await this.knownVideoIds(validated.projectId ?? null);
      const records: VideoReachSnapshot[] = [];
      let created = 0;
      let updated = 0;
      for (const raw of fetched.records) {
        const periodStart = date(raw.periodStart);
        const periodEnd = date(raw.periodEnd);
        const collectedAt = new Date(raw.collectedAt);
        const initialQuality = this.qualityService.evaluateReach([{
          id: '', createdAt: collectedAt, updatedAt: collectedAt,
          ingestionKey: '', projectId: validated.projectId ?? null, source: YOUTUBE_REACH_SOURCE,
          videoId: raw.videoId, periodStart, periodEnd, impressions: raw.impressions, ctr: raw.ctr,
          reportId: raw.reportId, jobId: raw.jobId,
          reportCreatedAt: raw.reportCreatedAt ? new Date(raw.reportCreatedAt) : null,
          collectedAt, freshnessAtCollection: classifyFreshness(periodEnd, collectedAt).state,
          qualityAtCollection: 'PARTIAL', qualityReasons: [], providerMetadata: null,
        }], { knownVideoIds, now: collectedAt });
        const saved = await this.reach.upsert({
          ingestionKey: key([YOUTUBE_REACH_SOURCE, validated.projectId ?? '', raw.videoId, raw.periodStart, raw.periodEnd]),
          projectId: validated.projectId ?? null,
          videoId: raw.videoId,
          periodStart,
          periodEnd,
          impressions: raw.impressions,
          ctr: raw.ctr,
          source: YOUTUBE_REACH_SOURCE,
          reportId: raw.reportId || null,
          jobId: raw.jobId,
          reportCreatedAt: raw.reportCreatedAt ? new Date(raw.reportCreatedAt) : null,
          collectedAt,
          freshnessAtCollection: classifyFreshness(periodEnd, collectedAt).state,
          qualityAtCollection: initialQuality.state,
          qualityReasons: initialQuality.reasons as unknown as Prisma.InputJsonValue,
          providerMetadata: { reportTypeId: YOUTUBE_REACH_REPORT_TYPE } as Prisma.InputJsonValue,
        });
        records.push(saved.snapshot);
        if (saved.created) created += 1; else updated += 1;
      }
      const quality = this.qualityService.evaluateReach(
        await this.reach.findAll({ projectId: validated.projectId ?? null, source: YOUTUBE_REACH_SOURCE }),
        { knownVideoIds },
      );
      const state = fetched.state === 'available' ? 'synchronized' : 'waiting_for_report';
      const lastSyncAt = records.reduce<Date | null>((latest, record) => !latest || record.collectedAt > latest ? record.collectedAt : latest, null);
      const lastReportAt = records.reduce<Date | null>((latest, record) => !latest || record.periodEnd > latest ? record.periodEnd : latest, null);
      await this.states.save({ source: YOUTUBE_REACH_SOURCE, reportTypeId: YOUTUBE_REACH_REPORT_TYPE, jobId: fetched.jobId, state, lastReportAt, lastSyncAt, lastErrorType: null });
      return { state, source: YOUTUBE_REACH_SOURCE, jobId: fetched.jobId, jobCreated: fetched.jobCreated, reportsProcessed: fetched.reportsProcessed, created, updated, records, quality };
    } catch (error) {
      const previous = await this.states.find(YOUTUBE_REACH_SOURCE);
      const lastErrorType = error instanceof YouTubeReachNotAuthorizedError ? 'authorization'
        : error instanceof YouTubeReachQuotaError ? 'quota' : 'temporary';
      await this.states.save({ source: YOUTUBE_REACH_SOURCE, reportTypeId: YOUTUBE_REACH_REPORT_TYPE, jobId: previous?.jobId ?? null, state: error instanceof YouTubeReachNotConfiguredError ? 'not_configured' : error instanceof YouTubeReachNotAuthorizedError ? 'not_authorized' : 'temporary_error', lastReportAt: previous?.lastReportAt ?? null, lastSyncAt: previous?.lastSyncAt ?? null, lastErrorType });
      if (error instanceof YouTubeReachNotConfiguredError || error instanceof YouTubeReachNotAuthorizedError || error instanceof YouTubeReachQuotaError || error instanceof YouTubeReachTemporaryError) throw error;
      throw new YouTubeReachTemporaryError();
    }
  }
}

export const youtubeReachSyncService = new YouTubeReachSyncService();
