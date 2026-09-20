import { DatabaseService } from '../database/DatabaseService';
import { VideoPerformanceSnapshotRepository } from '../database/repositories/VideoPerformanceSnapshotRepository';

export class ChannelContentValidationError extends Error {}
export class ChannelVideoNotFoundError extends Error {}

const identifier = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) throw new ChannelContentValidationError('videoId must be a non-empty string');
  return value.trim();
};

const view = (record: Awaited<ReturnType<VideoPerformanceSnapshotRepository['findAll']>>[number]) => ({
  id: record.id,
  videoId: record.videoId,
  title: record.title,
  format: record.format,
  publishedAt: record.publishedAt,
  collectedAt: record.collectedAt,
  periodStart: record.periodStart,
  periodEnd: record.periodEnd,
  views: record.views,
  watchTimeMinutes: record.watchTimeMinutes,
  averageViewDurationSeconds: record.averageViewDurationSeconds,
  averageViewPercentage: record.averageViewPercentage,
  impressions: record.impressions,
  ctr: record.ctr,
  subscribersGained: record.subscribersGained,
  likes: record.likes,
  comments: record.comments,
  confidence: record.confidence,
});

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
    return [...videos.values()].map(view);
  }

  async getVideo(videoId: string) {
    const id = identifier(videoId);
    const records = await this.snapshots.findAll({ videoId: id });
    if (records.length === 0) throw new ChannelVideoNotFoundError('video not found');
    return { current: view(records[0]), history: records.slice(0, 20).map(view) };
  }
}
