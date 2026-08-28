import type { AudienceSnapshot, Prisma, PrismaClient } from '@prisma/client';

export type SaveAudienceSnapshotData = Omit<Prisma.AudienceSnapshotUncheckedCreateInput, 'id' | 'createdAt' | 'updatedAt'>;

export interface AudienceSnapshotFilters {
  projectId?: string | null;
  dimension?: string;
  startDate?: Date;
  endDate?: Date;
}

export class AudienceSnapshotRepository {
  constructor(private readonly client: PrismaClient) {}

  async upsert(data: SaveAudienceSnapshotData): Promise<{ snapshot: AudienceSnapshot; created: boolean }> {
    const existing = await this.client.audienceSnapshot.findUnique({ where: { ingestionKey: data.ingestionKey } });
    const snapshot = await this.client.audienceSnapshot.upsert({ where: { ingestionKey: data.ingestionKey }, create: data, update: data });
    return { snapshot, created: existing === null };
  }

  async findAll(filters: AudienceSnapshotFilters = {}): Promise<AudienceSnapshot[]> {
    const where: Prisma.AudienceSnapshotWhereInput = {};
    if ('projectId' in filters) where.projectId = filters.projectId;
    if (filters.dimension) where.dimension = filters.dimension;
    if (filters.startDate || filters.endDate) where.periodStart = {
      ...(filters.startDate ? { gte: filters.startDate } : {}),
      ...(filters.endDate ? { lt: filters.endDate } : {}),
    };
    return this.client.audienceSnapshot.findMany({ where, orderBy: [{ periodStart: 'desc' }, { dimension: 'asc' }, { views: 'desc' }, { segment: 'asc' }, { id: 'asc' }] });
  }
}
