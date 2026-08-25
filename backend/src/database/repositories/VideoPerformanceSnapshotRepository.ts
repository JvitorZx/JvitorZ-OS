import type { Prisma, PrismaClient, VideoPerformanceSnapshot } from '@prisma/client';

export type SaveVideoPerformanceSnapshotData = Omit<
  VideoPerformanceSnapshot,
  'id' | 'createdAt' | 'updatedAt'
>;

export interface VideoPerformanceSnapshotFilters {
  projectId?: string | null;
  videoId?: string;
}

export class VideoPerformanceSnapshotRepository {
  private readonly delegate: PrismaClient['videoPerformanceSnapshot'];

  constructor(client: PrismaClient) {
    this.delegate = client.videoPerformanceSnapshot;
  }

  async upsert(data: SaveVideoPerformanceSnapshotData): Promise<{
    snapshot: VideoPerformanceSnapshot;
    created: boolean;
  }> {
    const existing = await this.delegate.findUnique({ where: { ingestionKey: data.ingestionKey } });
    const snapshot = await this.delegate.upsert({
      where: { ingestionKey: data.ingestionKey },
      create: data,
      update: data,
    });
    return { snapshot, created: existing === null };
  }

  async findAll(filters: VideoPerformanceSnapshotFilters = {}): Promise<VideoPerformanceSnapshot[]> {
    const where: Prisma.VideoPerformanceSnapshotWhereInput = {};
    if ('projectId' in filters) where.projectId = filters.projectId;
    if (filters.videoId) where.videoId = filters.videoId;
    return this.delegate.findMany({
      where,
      orderBy: [{ collectedAt: 'desc' }, { id: 'asc' }],
    });
  }

  async findById(id: string): Promise<VideoPerformanceSnapshot | null> {
    return this.delegate.findUnique({ where: { id } });
  }
}
