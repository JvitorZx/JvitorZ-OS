import type { ChannelContextEntry, Prisma, PrismaClient } from '@prisma/client';
import type { ChannelContextFilters } from '../../domains/channel-context';

const details = {
  supersedes: { select: { id: true, stableKey: true, statement: true, status: true } },
  supersededBy: { select: { id: true, stableKey: true, statement: true, status: true } },
  relations: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ChannelContextEntryInclude;

export type ChannelContextEntryDetails = Prisma.ChannelContextEntryGetPayload<{ include: typeof details }>;
export type CreateChannelContextData = Omit<Prisma.ChannelContextEntryUncheckedCreateInput, 'id' | 'createdAt' | 'updatedAt'>;

export class ChannelContextRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(data: CreateChannelContextData): Promise<ChannelContextEntryDetails> {
    return this.client.channelContextEntry.create({ data, include: details });
  }

  async findById(id: string): Promise<ChannelContextEntryDetails | null> {
    return this.client.channelContextEntry.findUnique({ where: { id }, include: details });
  }

  async findByStableKey(stableKey: string): Promise<ChannelContextEntryDetails | null> {
    return this.client.channelContextEntry.findUnique({ where: { stableKey }, include: details });
  }

  async findAll(filters: ChannelContextFilters = {}): Promise<ChannelContextEntryDetails[]> {
    return this.client.channelContextEntry.findMany({
      where: {
        ...(filters.projectId !== undefined ? { projectId: filters.projectId } : {}),
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.category ? { category: filters.category } : {}),
        ...(filters.currentOnly ? { status: { in: ['ACTIVE', 'CONFIRMED'] }, supersededBy: null } : {}),
        ...((filters.entityType || filters.entityId) ? { OR: [
          { entityType: filters.entityType, entityId: filters.entityId },
          { relations: { some: { entityType: filters.entityType, entityId: filters.entityId } } },
        ] } : {}),
        ...(filters.periodFrom || filters.periodTo ? { OR: [
          { occurredAt: { ...(filters.periodFrom ? { gte: filters.periodFrom } : {}), ...(filters.periodTo ? { lte: filters.periodTo } : {}) } },
          { periodStart: { ...(filters.periodTo ? { lte: filters.periodTo } : {}) }, periodEnd: { ...(filters.periodFrom ? { gte: filters.periodFrom } : {}) } },
        ] } : {}),
      },
      include: details,
      orderBy: [{ occurredAt: 'desc' }, { periodEnd: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      take: filters.limit ?? 100,
    });
  }

  async update(id: string, data: Prisma.ChannelContextEntryUncheckedUpdateInput): Promise<ChannelContextEntryDetails> {
    return this.client.channelContextEntry.update({ where: { id }, data, include: details });
  }

  async createBootstrap(data: CreateChannelContextData): Promise<{ entry: ChannelContextEntryDetails; created: boolean }> {
    const existing = await this.findByStableKey(data.stableKey);
    if (existing) return { entry: existing, created: false };
    try {
      return { entry: await this.create(data), created: true };
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') throw error;
      return { entry: await this.client.channelContextEntry.findUniqueOrThrow({ where: { stableKey: data.stableKey }, include: details }), created: false };
    }
  }

  async supersede(id: string, replacement: CreateChannelContextData): Promise<ChannelContextEntryDetails | null> {
    return this.client.$transaction(async (transaction) => {
      const previous = await transaction.channelContextEntry.findUnique({ where: { id }, include: { supersededBy: true } });
      if (!previous) return null;
      if (previous.supersededBy || previous.status === 'SUPERSEDED') return transaction.channelContextEntry.findUnique({ where: { id: previous.supersededBy?.id ?? id }, include: details });
      const next = await transaction.channelContextEntry.create({ data: { ...replacement, supersedesId: id }, include: details });
      await transaction.channelContextEntry.update({ where: { id }, data: { status: 'SUPERSEDED' } });
      return transaction.channelContextEntry.findUniqueOrThrow({ where: { id: next.id }, include: details });
    });
  }

  async relate(contextId: string, relation: string, entityType: string, entityId: string) {
    return this.client.channelContextRelation.upsert({
      where: { contextId_relation_entityType_entityId: { contextId, relation, entityType, entityId } },
      create: { contextId, relation, entityType, entityId },
      update: {},
    });
  }
}
