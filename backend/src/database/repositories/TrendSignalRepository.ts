import type { Prisma, PrismaClient, TrendSignal } from '@prisma/client';

export type SaveTrendSignalData = Omit<Prisma.TrendSignalUncheckedCreateInput, 'id' | 'createdAt' | 'updatedAt'>;

export class TrendSignalRepository {
  constructor(private readonly client: PrismaClient) {}

  async upsert(data: SaveTrendSignalData): Promise<TrendSignal> {
    const { key, ...values } = data;
    return this.client.trendSignal.upsert({ where: { key }, create: { key, ...values }, update: values });
  }

  async findAll(filters: { projectId?: string | null; subjectType?: string; classification?: string } = {}): Promise<TrendSignal[]> {
    const where: Prisma.TrendSignalWhereInput = {};
    if ('projectId' in filters) where.projectId = filters.projectId;
    if (filters.subjectType) where.subjectType = filters.subjectType;
    if (filters.classification) where.classification = filters.classification;
    return this.client.trendSignal.findMany({ where, orderBy: [{ detectedAt: 'desc' }, { confidence: 'desc' }, { id: 'asc' }] });
  }

  async findById(id: string): Promise<TrendSignal | null> {
    return this.client.trendSignal.findUnique({ where: { id } });
  }
}
