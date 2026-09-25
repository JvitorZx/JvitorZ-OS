import type { ChannelProfile, PrismaClient } from '@prisma/client';
import { DatabaseService } from '../database/DatabaseService';
import { ChannelProfileRepository } from '../database/repositories/ChannelProfileRepository';
import { ChannelProfileSession } from './ChannelProfileSession';
import { ChannelWorkspaceService } from './ChannelWorkspaceService';

export class ChannelProfileValidationError extends Error {}
export class ChannelProfileNotFoundError extends Error {}
export class ChannelProfileConflictError extends Error {}

const text = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) {
    throw new ChannelProfileValidationError(`${field} must be a non-empty string up to 120 characters`);
  }
  return value.trim();
};

export class ChannelProfileService {
  private readonly profiles: ChannelProfileRepository;

  constructor(
    private readonly client: PrismaClient = DatabaseService.client,
    profiles?: ChannelProfileRepository,
    private readonly session?: ChannelProfileSession,
    private readonly workspaces = new ChannelWorkspaceService(client),
  ) {
    this.profiles = profiles ?? new ChannelProfileRepository(client);
  }

  list(): Promise<ChannelProfile[]> { return this.profiles.findAll(); }
  getActive(): Promise<ChannelProfile | null> { return this.profiles.findActive(); }

  async create(input: { displayName: unknown; projectId?: unknown }): Promise<ChannelProfile> {
    const displayName = text(input.displayName, 'displayName');
    const projectId = input.projectId === undefined || input.projectId === null ? null : text(input.projectId, 'projectId');
    if (projectId && !await this.client.project.findUnique({ where: { id: projectId }, select: { id: true } })) {
      throw new ChannelProfileValidationError('projectId does not reference an existing project');
    }
    const profile = await this.profiles.create({ displayName, projectId });
    return projectId ? profile : this.workspaces.ensure(profile);
  }

  async activate(id: unknown): Promise<ChannelProfile> {
    const profileId = text(id, 'profileId');
    if (!await this.profiles.findById(profileId)) throw new ChannelProfileNotFoundError('channel profile not found');
    const profile = await this.profiles.activate(profileId);
    this.session?.setActiveProfileId(profile.id);
    return profile;
  }

  async connectObservedChannel(profileId: unknown, channel: { id: unknown; title: unknown; thumbnailUrl?: unknown }): Promise<ChannelProfile> {
    const id = text(profileId, 'profileId');
    const channelId = text(channel.id, 'channelId');
    const title = text(channel.title, 'channel title');
    const profile = await this.profiles.findById(id);
    if (!profile) throw new ChannelProfileNotFoundError('channel profile not found');
    if (profile.youtubeChannelId && profile.youtubeChannelId !== channelId) {
      throw new ChannelProfileConflictError('the authorized YouTube channel belongs to a different profile');
    }
    try {
      const thumbnailUrl = typeof channel.thumbnailUrl === 'string' && channel.thumbnailUrl.trim()
        ? channel.thumbnailUrl.trim()
        : null;
      const connected = await this.profiles.updateConnection(id, channelId, title, thumbnailUrl);
      return this.workspaces.ensure(connected);
    }
    catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
        throw new ChannelProfileConflictError('the authorized YouTube channel belongs to a different profile');
      }
      throw error;
    }
  }

  async adoptLegacyWorkspaceData(profileId: unknown): Promise<ChannelProfile> {
    const id = text(profileId, 'profileId');
    if (!await this.profiles.findById(id)) throw new ChannelProfileNotFoundError('channel profile not found');
    return this.profiles.adoptLegacyWorkspaceData(id);
  }
}
