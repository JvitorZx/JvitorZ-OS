import type { ChannelInsight, Prisma, PrismaClient } from '@prisma/client';
import { PrismaRepository } from './PrismaRepository';

export interface UpsertChannelInsightData {
  key: string;
  projectId: string | null;
  category: string;
  subject: string;
  statement: string;
  confidence: number;
  classification: string;
  evidence?: Prisma.InputJsonValue | null;
}

export class ChannelInsightRepository extends PrismaRepository<ChannelInsight> {
  constructor(client: PrismaClient) {
    super(client, client.channelInsight);
  }

  async upsert(data: UpsertChannelInsightData): Promise<ChannelInsight> {
    const { key, ...values } = data;
    return this.delegate.upsert({
      where: { key },
      create: { key, ...values },
      update: values,
    });
  }

  async findByProject(projectId: string | null): Promise<ChannelInsight[]> {
    return this.delegate.findMany({
      where: { projectId },
      orderBy: [{ confidence: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }],
    });
  }
}
