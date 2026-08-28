import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { AudienceSnapshotRepository } from '../../database/repositories/AudienceSnapshotRepository';
import { AudienceSyncStateRepository } from '../../database/repositories/AudienceSyncStateRepository';
import { DataQualityService, type DataQualityReport } from '../../domains/data-quality/DataQualityService';
import { classifyFreshness } from '../../domains/data-quality/FreshnessPolicy';
import { AUDIENCE_DIMENSIONS, GoogleYouTubeAudienceProvider, YOUTUBE_AUDIENCE_SOURCE, type YouTubeAudienceProvider } from '../../integrations/youtube/YouTubeAudienceProvider';
import { YouTubeAnalyticsNotAuthorizedError, YouTubeAnalyticsNotConfiguredError, YouTubeAnalyticsQuotaError, YouTubeAnalyticsTemporaryError } from '../../integrations/youtube/YouTubeAnalyticsErrors';
import { GoogleService } from '../GoogleService';

export class AudienceSyncValidationError extends Error { constructor(message: string) { super(message); this.name = 'AudienceSyncValidationError'; } }
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: string, field: string) => { const parsed = new Date(`${value}T00:00:00.000Z`); if (!datePattern.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new AudienceSyncValidationError(`${field} must use YYYY-MM-DD`); return parsed; };
const ingestionKey = (values: readonly string[]) => createHash('sha256').update(values.join('|')).digest('hex');

export class YouTubeAudienceSyncService {
  private readonly google: GoogleService;
  private readonly provider: YouTubeAudienceProvider;
  private readonly snapshots: AudienceSnapshotRepository;
  private readonly states: AudienceSyncStateRepository;
  private readonly quality = new DataQualityService();

  constructor(dependencies: { googleService?: GoogleService; provider?: YouTubeAudienceProvider; snapshotRepository?: AudienceSnapshotRepository; stateRepository?: AudienceSyncStateRepository } = {}) {
    this.google = dependencies.googleService ?? new GoogleService();
    this.provider = dependencies.provider ?? new GoogleYouTubeAudienceProvider({ googleService: this.google });
    this.snapshots = dependencies.snapshotRepository ?? new AudienceSnapshotRepository(DatabaseService.client);
    this.states = dependencies.stateRepository ?? new AudienceSyncStateRepository(DatabaseService.client);
  }

  validate(input: { startDate: string; endDate: string; projectId?: string | null }) {
    const start = validDate(input.startDate, 'startDate'); const end = validDate(input.endDate, 'endDate');
    if (start > end) throw new AudienceSyncValidationError('startDate must not be after endDate');
    if ((end.getTime() - start.getTime()) / 86_400_000 + 1 > 31) throw new AudienceSyncValidationError('audience sync accepts at most 31 days');
    return { startDate: input.startDate, endDate: input.endDate, projectId: input.projectId?.trim() || null };
  }

  async getQuality(projectId?: string | null): Promise<DataQualityReport> {
    return this.quality.evaluateAudience(await this.snapshots.findAll({ projectId: projectId?.trim() || null }), AUDIENCE_DIMENSIONS);
  }

  async getStatus() {
    const [saved, quality] = await Promise.all([this.states.find(YOUTUBE_AUDIENCE_SOURCE), this.getQuality()]);
    if (!this.google.isConfigured()) return { state: 'not_configured', lastSyncAt: saved?.lastSyncAt ?? null, lastErrorType: null, missingData: AUDIENCE_DIMENSIONS, quality };
    if (!this.google.isAuthenticated()) return { state: 'not_authorized', lastSyncAt: saved?.lastSyncAt ?? null, lastErrorType: 'authorization', missingData: saved?.missingData ?? AUDIENCE_DIMENSIONS, quality };
    return { state: saved?.state ?? (quality.sampleSize ? 'synchronized' : 'not_synchronized'), lastSyncAt: saved?.lastSyncAt ?? quality.latestCollectedAt, lastErrorType: saved?.lastErrorType ?? null, missingData: saved?.missingData ?? AUDIENCE_DIMENSIONS, quality };
  }

  async sync(input: { startDate: string; endDate: string; projectId?: string | null }) {
    const validated = this.validate(input);
    try {
      const result = await this.provider.fetch(validated);
      let created = 0; let updated = 0;
      for (const raw of result.records) {
        const quality = this.quality.evaluateAudience([{
          id: '', projectId: validated.projectId, ingestionKey: '', source: YOUTUBE_AUDIENCE_SOURCE, ...raw,
          periodStart: new Date(`${raw.periodStart}T00:00:00.000Z`), periodEnd: new Date(`${raw.periodEnd}T00:00:00.000Z`),
          freshnessAtCollection: 'RECENT', qualityAtCollection: 'PARTIAL', qualityReasons: [], providerMetadata: null, createdAt: raw.collectedAt, updatedAt: raw.collectedAt,
        }], [raw.dimension], raw.collectedAt);
        const saved = await this.snapshots.upsert({
          projectId: validated.projectId, ingestionKey: ingestionKey([YOUTUBE_AUDIENCE_SOURCE, validated.projectId ?? '', raw.dimension, raw.segment, raw.format, raw.periodStart, raw.periodEnd]),
          dimension: raw.dimension, segment: raw.segment, format: raw.format, periodStart: new Date(`${raw.periodStart}T00:00:00.000Z`), periodEnd: new Date(`${raw.periodEnd}T00:00:00.000Z`),
          views: raw.views, engagedViews: raw.engagedViews, watchTimeMinutes: raw.watchTimeMinutes, averageViewDurationSeconds: raw.averageViewDurationSeconds, averageViewPercentage: raw.averageViewPercentage,
          source: YOUTUBE_AUDIENCE_SOURCE, collectedAt: raw.collectedAt, freshnessAtCollection: classifyFreshness(new Date(`${raw.periodEnd}T00:00:00.000Z`), raw.collectedAt).state,
          qualityAtCollection: quality.state, qualityReasons: quality.reasons as unknown as Prisma.InputJsonValue,
          providerMetadata: { officialDimension: raw.dimension } as Prisma.InputJsonValue,
        });
        if (saved.created) created += 1; else updated += 1;
      }
      const quality = await this.getQuality(validated.projectId);
      const state = result.availableDimensions.length && result.missingDimensions.length ? 'partial' : result.availableDimensions.length ? 'synchronized' : 'missing';
      await this.states.save({ source: YOUTUBE_AUDIENCE_SOURCE, state, lastSyncAt: new Date(), lastErrorType: null, missingData: result.missingDimensions as unknown as Prisma.InputJsonValue });
      return { state, created, updated, availableDimensions: result.availableDimensions, missingDimensions: result.missingDimensions, quality };
    } catch (error) {
      const previous = await this.states.find(YOUTUBE_AUDIENCE_SOURCE);
      const errorType = error instanceof YouTubeAnalyticsNotAuthorizedError ? 'authorization' : error instanceof YouTubeAnalyticsQuotaError ? 'quota' : 'temporary';
      const state = error instanceof YouTubeAnalyticsNotConfiguredError ? 'not_configured' : error instanceof YouTubeAnalyticsNotAuthorizedError ? 'not_authorized' : 'temporary_error';
      await this.states.save({ source: YOUTUBE_AUDIENCE_SOURCE, state, lastSyncAt: previous?.lastSyncAt ?? null, lastErrorType: errorType, missingData: previous?.missingData ?? AUDIENCE_DIMENSIONS as unknown as Prisma.InputJsonValue });
      if (error instanceof YouTubeAnalyticsNotConfiguredError || error instanceof YouTubeAnalyticsNotAuthorizedError || error instanceof YouTubeAnalyticsQuotaError || error instanceof YouTubeAnalyticsTemporaryError) throw error;
      throw new YouTubeAnalyticsTemporaryError();
    }
  }
}

export const youtubeAudienceSyncService = new YouTubeAudienceSyncService();
