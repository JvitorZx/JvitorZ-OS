import type { AutomationAuditEvent, Prisma, PrismaClient } from '@prisma/client';

export class AutomationAuditRepository {
  constructor(private readonly client: PrismaClient) {}

  append(data: Prisma.AutomationAuditEventUncheckedCreateInput): Promise<AutomationAuditEvent> {
    return this.client.automationAuditEvent.create({ data });
  }

  listByAutomation(automationId: string, limit = 100): Promise<AutomationAuditEvent[]> {
    return this.client.automationAuditEvent.findMany({
      where: { automationId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: limit,
    });
  }
}
