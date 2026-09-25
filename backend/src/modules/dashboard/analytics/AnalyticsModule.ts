import { DatabaseService } from '../../../database/DatabaseService';
import { VideoPerformanceSnapshotRepository } from '../../../database/repositories/VideoPerformanceSnapshotRepository';
import { VideoReachSnapshotRepository } from '../../../database/repositories/VideoReachSnapshotRepository';
import { DataQualityService } from '../../../domains/data-quality/DataQualityService';
import { AudienceIntelligenceService } from '../../../services/audience/AudienceIntelligenceService';
import { ChannelProfileService } from '../../../services/ChannelProfileService';

const average = (values: Array<number | null>): number | null => {
  const known = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
};

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export class AnalyticsModule {
  constructor(
    private readonly snapshots = new VideoPerformanceSnapshotRepository(DatabaseService.client),
    private readonly reachSnapshots = new VideoReachSnapshotRepository(DatabaseService.client),
    private readonly qualityService = new DataQualityService(),
    private readonly audienceIntelligence = new AudienceIntelligenceService(),
    private readonly channelProfiles: Pick<ChannelProfileService, 'getActive'> = new ChannelProfileService(),
  ) {}

  async getDashboardAnalytics() {
    const activeProfile = await this.channelProfiles.getActive();
    const hasScopedData = !activeProfile || Boolean(activeProfile.projectId || activeProfile.usesLegacyWorkspaceData);
    const projectId = activeProfile?.projectId ?? null;
    const persisted = hasScopedData ? await this.snapshots.findAll({ projectId }) : [];
    let reach = [] as Awaited<ReturnType<VideoReachSnapshotRepository['findAll']>>;
    try { reach = hasScopedData ? await this.reachSnapshots.findAll({ projectId }) : []; } catch { reach = []; }
    const latestByVideo = new Map<string, (typeof persisted)[number]>();
    for (const snapshot of persisted) {
      if (!latestByVideo.has(snapshot.videoId)) latestByVideo.set(snapshot.videoId, snapshot);
    }
    const records = [...latestByVideo.values()];
    const total = (field: 'views' | 'watchTimeMinutes') => records.reduce(
      (sum, record) => sum + (record[field] ?? 0),
      0,
    );
    let audience = null;
    try { audience = hasScopedData ? await this.audienceIntelligence.summary(projectId) : null; } catch { audience = null; }
    return {
      performance: {
        views: records.length ? total('views') : null,
        watchTime: records.length ? total('watchTimeMinutes') : null,
        averageViewDuration: average(records.map(({ averageViewDurationSeconds }) => averageViewDurationSeconds)),
      },
      retention: {
        percentage: average(records.map(({ averageViewPercentage }) => averageViewPercentage)),
      },
      trafficSources: [],
      audience,
      sampleSize: records.length,
      lastDataAt: records[0]?.collectedAt ?? null,
      reach: {
        impressions: reach.reduce((sum, record) => sum + record.impressions, 0),
        ctrMedian: median(reach.map(({ ctr }) => ctr)),
        sampleSize: reach.length,
        lastDataAt: reach[0]?.collectedAt ?? null,
        quality: this.qualityService.evaluateReach(reach, { knownVideoIds: new Set(records.map(({ videoId }) => videoId)) }),
      },
    };
  }
}
