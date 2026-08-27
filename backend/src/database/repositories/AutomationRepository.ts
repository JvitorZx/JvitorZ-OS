import type { Automation, Prisma, PrismaClient } from '@prisma/client';

export class AutomationRepository {
  constructor(private readonly client: PrismaClient) {}

  create(data: Prisma.AutomationUncheckedCreateInput): Promise<Automation> {
    return this.client.automation.create({ data });
  }

  findAll(): Promise<Automation[]> {
    return this.client.automation.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
  }

  findById(id: string): Promise<Automation | null> {
    return this.client.automation.findUnique({ where: { id } });
  }

  update(id: string, data: Prisma.AutomationUncheckedUpdateInput): Promise<Automation> {
    return this.client.automation.update({ where: { id }, data });
  }

  findDue(now: Date): Promise<Automation[]> {
    return this.client.automation.findMany({
      where: { enabled: true, status: 'ACTIVE', nextRunAt: { lte: now } },
      orderBy: [{ nextRunAt: 'asc' }, { id: 'asc' }],
    });
  }

  async getOperationalSummary(now = new Date()) {
    const [total, active, paused, blocked, error, due] = await Promise.all([
      this.client.automation.count(),
      this.client.automation.count({ where: { enabled: true, status: 'ACTIVE' } }),
      this.client.automation.count({ where: { status: 'PAUSED' } }),
      this.client.automation.count({ where: { status: 'BLOCKED' } }),
      this.client.automation.count({ where: { status: 'ERROR' } }),
      this.client.automation.count({ where: { enabled: true, status: 'ACTIVE', nextRunAt: { lte: now } } }),
    ]);
    return { total, active, paused, blocked, error, due };
  }
}
