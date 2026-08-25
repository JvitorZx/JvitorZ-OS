import type { PerformanceSignal, Prisma, PrismaClient } from '@prisma/client';
import { PrismaRepository } from './PrismaRepository';

export type CreatePerformanceSignalData = Omit<
  PerformanceSignal,
  'id' | 'createdAt' | 'key' | 'performanceSnapshotId' | 'series' | 'confidence'
> & Partial<Pick<PerformanceSignal, 'key' | 'performanceSnapshotId' | 'series' | 'confidence'>>;

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

  async findAll(filters: {
    projectId?: string | null;
    performanceSnapshotId?: string;
  } = {}): Promise<PerformanceSignal[]> {
    const where: Prisma.PerformanceSignalWhereInput = {};
    if ('projectId' in filters) where.projectId = filters.projectId;
    if (filters.performanceSnapshotId) where.performanceSnapshotId = filters.performanceSnapshotId;
    return this.delegate.findMany({
      where,
      orderBy: [{ measuredAt: 'desc' }, { id: 'asc' }],
    });
  }

  async replaceForSnapshot(
    performanceSnapshotId: string,
    signals: readonly CreatePerformanceSignalData[],
  ): Promise<PerformanceSignal[]> {
    const keys = signals.flatMap(({ key }) => key ? [key] : []);
    return this.client.$transaction(async (tx) => {
      await tx.performanceSignal.deleteMany({
        where: {
          performanceSnapshotId,
          ...(keys.length > 0 ? { key: { notIn: keys } } : {}),
        },
      });
      const saved: PerformanceSignal[] = [];
      for (const signal of signals) {
        if (!signal.key) {
          saved.push(await tx.performanceSignal.create({ data: signal }));
          continue;
        }
        const { key, ...values } = signal;
        saved.push(await tx.performanceSignal.upsert({
          where: { key },
          create: { key, ...values },
          update: values,
        }));
      }
      return saved;
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
