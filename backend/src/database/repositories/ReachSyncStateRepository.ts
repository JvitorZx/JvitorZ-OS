import type { PrismaClient, ReachSyncState } from '@prisma/client';

export class ReachSyncStateRepository {
  private readonly delegate: PrismaClient['reachSyncState'];
  constructor(client: PrismaClient) { this.delegate = client.reachSyncState; }

  async find(source: string): Promise<ReachSyncState | null> {
    return this.delegate.findUnique({ where: { source } });
  }

  async save(data: Omit<ReachSyncState, 'updatedAt'>): Promise<ReachSyncState> {
    return this.delegate.upsert({ where: { source: data.source }, create: data, update: data });
  }
}
