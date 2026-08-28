import { DatabaseService } from '../../../database/DatabaseService';
import { VideoPerformanceSnapshotRepository } from '../../../database/repositories/VideoPerformanceSnapshotRepository';
import { VideoReachSnapshotRepository } from '../../../database/repositories/VideoReachSnapshotRepository';
import { DataQualityService } from '../../../domains/data-quality/DataQualityService';

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
  ) {}

  async getDashboardAnalytics() {
    const persisted = await this.snapshots.findAll();
    let reach = [] as Awaited<ReturnType<VideoReachSnapshotRepository['findAll']>>;
    try { reach = await this.reachSnapshots.findAll(); } catch { reach = []; }
    const latestByVideo = new Map<string, (typeof persisted)[number]>();
    for (const snapshot of persisted) {
      if (!latestByVideo.has(snapshot.videoId)) latestByVideo.set(snapshot.videoId, snapshot);
    }
    const records = [...latestByVideo.values()];
    const total = (field: 'views' | 'watchTimeMinutes') => records.reduce(
      (sum, record) => sum + (record[field] ?? 0),
      0,
    );
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
