import type { ChannelProfile, PrismaClient } from '@prisma/client';

export interface CreateChannelProfileData {
  displayName: string;
  projectId?: string | null;
}

export class ChannelProfileRepository {
  constructor(private readonly client: PrismaClient) {}

  create(data: CreateChannelProfileData): Promise<ChannelProfile> {
    return this.client.channelProfile.create({
      data: { displayName: data.displayName, projectId: data.projectId ?? null },
    });
  }

  findAll(): Promise<ChannelProfile[]> {
    return this.client.channelProfile.findMany({
      orderBy: [{ isActive: 'desc' }, { displayName: 'asc' }, { id: 'asc' }],
    });
  }

  findById(id: string): Promise<ChannelProfile | null> {
    return this.client.channelProfile.findUnique({ where: { id } });
  }

  findActive(): Promise<ChannelProfile | null> {
    return this.client.channelProfile.findFirst({
      where: { isActive: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
  }

  async activate(id: string): Promise<ChannelProfile> {
    return this.client.$transaction(async (transaction) => {
      await transaction.channelProfile.updateMany({ where: { isActive: true }, data: { isActive: false } });
      return transaction.channelProfile.update({ where: { id }, data: { isActive: true } });
    });
  }

  updateConnection(id: string, channelId: string, displayName: string, thumbnailUrl: string | null): Promise<ChannelProfile> {
    return this.client.channelProfile.update({
      where: { id },
      data: { youtubeChannelId: channelId, displayName, thumbnailUrl, connectionState: 'CONNECTED' },
    });
  }

  adoptLegacyWorkspaceData(id: string): Promise<ChannelProfile> {
    return this.client.channelProfile.update({
      where: { id },
      data: { usesLegacyWorkspaceData: true, legacyDataAdoptedAt: new Date() },
    });
  }
}
