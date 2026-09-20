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

  async listPage(page = 1, pageSize = 12) {
    if (!Number.isInteger(page) || page < 1) throw new ChannelContentValidationError('page must be a positive integer');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new ChannelContentValidationError('pageSize must be an integer from 1 to 50');
    const records = await this.snapshots.findAll();
    const videos = new Map<string, (typeof records)[number]>();
    for (const record of records) if (!videos.has(record.videoId)) videos.set(record.videoId, record);
    const all = [...videos.values()]; const offset = (page - 1) * pageSize;
    return { items: all.slice(offset, offset + pageSize).map(view), page, pageSize, total: all.length, totalPages: Math.ceil(all.length / pageSize) };
  }

  async getVideo(videoId: string) {
    const id = identifier(videoId);
    const records = await this.snapshots.findAll({ videoId: id });
    if (records.length === 0) throw new ChannelVideoNotFoundError('video not found');
    return { current: view(records[0]), history: records.slice(0, 20).map(view) };
  }

  async getSummary() {
    const records = await this.snapshots.findAll();
    const latest = new Map<string, (typeof records)[number]>();
    for (const record of records) if (!latest.has(record.videoId)) latest.set(record.videoId, record);
    const values = [...latest.values()];
    const formats = values.reduce<Record<string, number>>((result, record) => {
      const key = record.format?.trim() || 'UNKNOWN';
      result[key] = (result[key] ?? 0) + 1;
      return result;
    }, {});
    const covered = (field: keyof (typeof values)[number]) => values.filter((record) => record[field] !== null && record[field] !== undefined).length;
    const coverageFor = (items: typeof values) => {
      const count = (field: keyof (typeof values)[number]) => items.filter((record) => record[field] !== null && record[field] !== undefined).length;
      return {
        views: count('views'), watchTime: count('watchTimeMinutes'), retention: count('averageViewPercentage'),
        impressions: count('impressions'), ctr: count('ctr'), subscribers: count('subscribersGained'),
        interactions: items.filter((record) => record.likes !== null || record.comments !== null).length,
      };
    };
    const formatCohorts = Object.fromEntries(Object.keys(formats).sort().map((format) => {
      const items = values.filter((record) => (record.format?.trim() || 'UNKNOWN') === format);
      return [format, { videos: items.length, coverage: coverageFor(items) }];
    }));
    return {
      videos: values.length,
      observations: records.length,
      formats,
      latestCollectedAt: records[0]?.collectedAt ?? null,
      earliestCollectedAt: records.at(-1)?.collectedAt ?? null,
      coverage: {
        views: covered('views'), watchTime: covered('watchTimeMinutes'), retention: covered('averageViewPercentage'),
        impressions: covered('impressions'), ctr: covered('ctr'), subscribers: covered('subscribersGained'),
        interactions: values.filter((record) => record.likes !== null || record.comments !== null).length,
      },
      formatCohorts,
    };
  }
}
