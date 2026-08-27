import type { AutomationRun, Prisma, PrismaClient } from '@prisma/client';

export class AutomationRunRepository {
  constructor(private readonly client: PrismaClient) {}

  create(data: Prisma.AutomationRunUncheckedCreateInput): Promise<AutomationRun> {
    return this.client.automationRun.create({ data });
  }

  findById(id: string): Promise<AutomationRun | null> {
    return this.client.automationRun.findUnique({ where: { id } });
  }

  findByOccurrence(automationId: string, occurrenceKey: string): Promise<AutomationRun | null> {
    return this.client.automationRun.findUnique({ where: { automationId_occurrenceKey: { automationId, occurrenceKey } } });
  }

  findActive(automationId: string): Promise<AutomationRun | null> {
    return this.client.automationRun.findFirst({
      where: { automationId, status: { in: ['PENDING', 'RUNNING'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  findAwaitingReview(automationId: string): Promise<AutomationRun | null> {
    return this.client.automationRun.findFirst({
      where: { automationId, status: 'BLOCKED', orchestrationExecutionId: { not: null } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
  }

  update(id: string, data: Prisma.AutomationRunUncheckedUpdateInput): Promise<AutomationRun> {
    return this.client.automationRun.update({ where: { id }, data });
  }

  async tryResumeBlocked(id: string): Promise<boolean> {
    const result = await this.client.automationRun.updateMany({
      where: { id, status: 'BLOCKED' }, data: { status: 'RUNNING', startedAt: new Date(), completedAt: null },
    });
    return result.count === 1;
  }

  listByAutomation(automationId: string, limit = 50): Promise<AutomationRun[]> {
    return this.client.automationRun.findMany({
      where: { automationId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: limit,
    });
  }
}
