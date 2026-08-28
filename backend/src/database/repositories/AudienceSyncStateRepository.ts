import type { Prisma, PrismaClient } from '@prisma/client';

export class AudienceSyncStateRepository {
  constructor(private readonly client: PrismaClient) {}
  find(source: string) { return this.client.audienceSyncState.findUnique({ where: { source } }); }
  save(data: Prisma.AudienceSyncStateUncheckedCreateInput) {
    return this.client.audienceSyncState.upsert({ where: { source: data.source }, create: data, update: data });
  }
}
