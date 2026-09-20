import { DatabaseService } from '../database/DatabaseService';
import { VideoPerformanceSnapshotRepository } from '../database/repositories/VideoPerformanceSnapshotRepository';

export class ChannelContentValidationError extends Error {}

export class ChannelContentService {
  constructor(
    private readonly snapshots = new VideoPerformanceSnapshotRepository(DatabaseService.client),
  ) {}

  async listRecent(limit = 12) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new ChannelContentValidationError('limit must be an integer from 1 to 50');
    }
    const records = await this.snapshots.findAll();
    const videos = new Map<string, (typeof records)[number]>();
    for (const record of records) {
      if (!videos.has(record.videoId)) videos.set(record.videoId, record);
      if (videos.size === limit) break;
    }
    return [...videos.values()].map((record) => ({
      id: record.id,
      videoId: record.videoId,
      title: record.title,
      format: record.format,
      publishedAt: record.publishedAt,
      collectedAt: record.collectedAt,
      views: record.views,
      watchTimeMinutes: record.watchTimeMinutes,
      averageViewPercentage: record.averageViewPercentage,
      impressions: record.impressions,
      ctr: record.ctr,
    }));
  }
}
