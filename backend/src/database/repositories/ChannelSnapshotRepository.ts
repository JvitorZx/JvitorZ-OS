import type { ChannelSnapshot, PrismaClient } from '@prisma/client';

export type SaveChannelSnapshotData = Omit<ChannelSnapshot, 'id' | 'createdAt' | 'updatedAt'>;

export class ChannelSnapshotRepository {
  private readonly delegate: PrismaClient['channelSnapshot'];

  constructor(client: PrismaClient) {
    this.delegate = client.channelSnapshot;
  }

  async upsert(data: SaveChannelSnapshotData): Promise<ChannelSnapshot> {
    return this.delegate.upsert({
      where: { channelId: data.channelId },
      create: data,
      update: data,
    });
  }

  async findLatest(): Promise<ChannelSnapshot | null> {
    return this.delegate.findFirst({
      orderBy: [{ collectedAt: 'desc' }, { id: 'asc' }],
    });
  }
}
