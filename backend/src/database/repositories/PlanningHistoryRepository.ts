import type { PlanningHistory, Prisma, PrismaClient } from '@prisma/client';

export class PlanningHistoryRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(data: {
    planId: string;
    itemId?: string | null;
    event: string;
    reason: string;
    before?: Prisma.InputJsonValue;
    after: Prisma.InputJsonValue;
  }): Promise<PlanningHistory> {
    return this.client.planningHistory.create({ data });
  }

  async findAll(filters: { planId?: string; itemId?: string; limit?: number } = {}): Promise<PlanningHistory[]> {
    return this.client.planningHistory.findMany({
      where: { ...(filters.planId ? { planId: filters.planId } : {}), ...(filters.itemId ? { itemId: filters.itemId } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: filters.limit ?? 100,
    });
  }
}
