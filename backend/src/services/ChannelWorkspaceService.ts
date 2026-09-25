import type { ChannelProfile, PrismaClient } from '@prisma/client';
import { DatabaseService } from '../database/DatabaseService';

const LOCAL_WORKSPACE_OWNER_EMAIL = 'oss-channel-workspaces@local.invalid';

/**
 * Gives each non-legacy channel profile an independent Project boundary.
 * Legacy data remains deliberately attached only to the profile that adopted it.
 */
export class ChannelWorkspaceService {
  constructor(private readonly client: PrismaClient = DatabaseService.client) {}

  async ensure(profile: ChannelProfile): Promise<ChannelProfile> {
    if (profile.projectId || profile.usesLegacyWorkspaceData) return profile;

    try {
      return await this.client.$transaction(async (transaction) => {
        const current = await transaction.channelProfile.findUnique({ where: { id: profile.id } });
        if (!current) throw new Error('channel profile not found while creating workspace');
        if (current.projectId || current.usesLegacyWorkspaceData) return current;

        const owner = await transaction.user.upsert({
          where: { email: LOCAL_WORKSPACE_OWNER_EMAIL },
          update: {},
          create: { email: LOCAL_WORKSPACE_OWNER_EMAIL, name: 'OSS local workspace owner', role: 'system' },
        });
        const workspace = await transaction.project.create({
          data: {
            name: current.displayName,
            description: 'Workspace isolado para um perfil de canal.',
            ownerId: owner.id,
          },
        });
        return transaction.channelProfile.update({ where: { id: current.id }, data: { projectId: workspace.id } });
      });
    } catch (error) {
      // Another request may have attached the one-to-one workspace first.
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
        const current = await this.client.channelProfile.findUnique({ where: { id: profile.id } });
        if (current?.projectId) return current;
      }
      throw error;
    }
  }
}
