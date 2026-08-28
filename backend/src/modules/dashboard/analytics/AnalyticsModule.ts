import { DatabaseService } from '../../../database/DatabaseService';
import { VideoPerformanceSnapshotRepository } from '../../../database/repositories/VideoPerformanceSnapshotRepository';

const average = (values: Array<number | null>): number | null => {
  const known = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
};

export class AnalyticsModule {
  constructor(private readonly snapshots = new VideoPerformanceSnapshotRepository(DatabaseService.client)) {}

  async getDashboardAnalytics() {
    const persisted = await this.snapshots.findAll();
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
    };
  }
}
