import type { AutomationRuntimeEvent, Prisma, PrismaClient } from '@prisma/client';

export class AutomationRuntimeEventRepository {
  constructor(private readonly client: PrismaClient) {}

  append(data: Prisma.AutomationRuntimeEventCreateInput): Promise<AutomationRuntimeEvent> {
    return this.client.automationRuntimeEvent.create({ data });
  }

  listRecent(limit = 100): Promise<AutomationRuntimeEvent[]> {
    return this.client.automationRuntimeEvent.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: limit,
    });
  }
}
