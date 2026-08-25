import type { PerformanceSignal, PrismaClient } from '@prisma/client';
import { PrismaRepository } from './PrismaRepository';

export type CreatePerformanceSignalData = Omit<PerformanceSignal, 'id' | 'createdAt'>;

export class PerformanceSignalRepository extends PrismaRepository<PerformanceSignal> {
  constructor(client: PrismaClient) {
    super(client, client.performanceSignal);
  }

  async create(data: CreatePerformanceSignalData): Promise<PerformanceSignal> {
    return this.delegate.create({ data });
  }

  async findByProject(projectId: string | null): Promise<PerformanceSignal[]> {
    return this.delegate.findMany({
      where: { projectId },
      orderBy: [{ measuredAt: 'desc' }, { id: 'asc' }],
    });
  }

  async findRelevant(input: {
    projectId: string | null;
    videoIdeaId: string;
    game: string | null;
    format: string;
  }): Promise<PerformanceSignal[]> {
    const matches = [
      { videoIdeaId: input.videoIdeaId },
      ...(input.game ? [{ game: input.game }] : []),
      { format: input.format },
    ];

    return this.delegate.findMany({
      where: { projectId: input.projectId, OR: matches },
      orderBy: [{ measuredAt: 'desc' }, { id: 'asc' }],
    });
  }
}
