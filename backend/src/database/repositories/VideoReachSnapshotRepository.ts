import type { Prisma, PrismaClient, VideoReachSnapshot } from '@prisma/client';

export type SaveVideoReachSnapshotData = Omit<
  Prisma.VideoReachSnapshotUncheckedCreateInput,
  'id' | 'createdAt' | 'updatedAt'
>;

export interface VideoReachSnapshotFilters {
  projectId?: string | null;
  videoId?: string;
  source?: string;
}

export class VideoReachSnapshotRepository {
  private readonly delegate: PrismaClient['videoReachSnapshot'];

  constructor(client: PrismaClient) { this.delegate = client.videoReachSnapshot; }

  async upsert(data: SaveVideoReachSnapshotData): Promise<{ snapshot: VideoReachSnapshot; created: boolean }> {
    const existing = await this.delegate.findUnique({ where: { ingestionKey: data.ingestionKey } });
    const snapshot = await this.delegate.upsert({ where: { ingestionKey: data.ingestionKey }, create: data, update: data });
    return { snapshot, created: existing === null };
  }

  async findAll(filters: VideoReachSnapshotFilters = {}): Promise<VideoReachSnapshot[]> {
    const where: Prisma.VideoReachSnapshotWhereInput = {};
    if ('projectId' in filters) where.projectId = filters.projectId;
    if (filters.videoId) where.videoId = filters.videoId;
    if (filters.source) where.source = filters.source;
    return this.delegate.findMany({ where, orderBy: [{ periodStart: 'desc' }, { videoId: 'asc' }, { id: 'asc' }] });
  }

  async findLatestBySource(source: string): Promise<VideoReachSnapshot | null> {
    return this.delegate.findFirst({ where: { source }, orderBy: [{ collectedAt: 'desc' }, { id: 'asc' }] });
  }
}
