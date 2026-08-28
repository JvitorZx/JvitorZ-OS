import type { ContentPattern, Prisma, PrismaClient } from '@prisma/client';

export type SaveContentPatternData = Omit<Prisma.ContentPatternUncheckedCreateInput, 'id' | 'createdAt' | 'updatedAt'>;

export class ContentPatternRepository {
  constructor(private readonly client: PrismaClient) {}

  async upsert(data: SaveContentPatternData): Promise<ContentPattern> {
    const { key, ...values } = data;
    return this.client.contentPattern.upsert({ where: { key }, create: { key, ...values }, update: values });
  }

  async findAll(filters: { projectId?: string | null; patternType?: string } = {}): Promise<ContentPattern[]> {
    const where: Prisma.ContentPatternWhereInput = {};
    if ('projectId' in filters) where.projectId = filters.projectId;
    if (filters.patternType) where.patternType = filters.patternType;
    return this.client.contentPattern.findMany({ where, orderBy: [{ detectedAt: 'desc' }, { confidence: 'desc' }, { id: 'asc' }] });
  }

  async findById(id: string): Promise<ContentPattern | null> {
    return this.client.contentPattern.findUnique({ where: { id } });
  }
}
