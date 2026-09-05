import type { Prisma, PrismaClient, ResearchOpportunity } from '@prisma/client';

export type ResearchOpportunityWithHistory = Prisma.ResearchOpportunityGetPayload<{
  include: { researchHistory: true };
}>;

export class ResearchOpportunityRepository {
  constructor(private readonly client: PrismaClient) {}

  async findAll(filters: {
    projectId?: string | null;
    state?: string;
    limit?: number;
  } = {}): Promise<ResearchOpportunityWithHistory[]> {
    const where: Prisma.ResearchOpportunityWhereInput = {};
    if ('projectId' in filters) where.researchHistory = { projectId: filters.projectId };
    if (filters.state) where.state = filters.state;
    return this.client.researchOpportunity.findMany({
      where,
      include: { researchHistory: true },
      orderBy: [{ researchHistory: { researchedAt: 'desc' } }, { rank: 'asc' }, { id: 'asc' }],
      take: filters.limit ?? 50,
    });
  }

  async findById(id: string): Promise<ResearchOpportunityWithHistory | null> {
    return this.client.researchOpportunity.findUnique({ where: { id }, include: { researchHistory: true } });
  }

  async findBySession(id: string, subjectType?: string): Promise<ResearchOpportunity[]> {
    return this.client.researchOpportunity.findMany({
      where: { researchHistoryId: id, ...(subjectType ? { subjectType } : {}) },
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
    });
  }
}
