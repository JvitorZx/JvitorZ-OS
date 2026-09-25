import type { ChannelSnapshot } from '@prisma/client';
import { DatabaseService } from '../database/DatabaseService';
import { ChannelSnapshotRepository } from '../database/repositories/ChannelSnapshotRepository';
import { ChannelProfileConflictError, ChannelProfileService } from './ChannelProfileService';
import ChannelService from '../integrations/youtube/ChannelService';
import type { OperationalState } from '../domains/integrations/OperationalState';
import {
  GoogleService,
  isGoogleReauthenticationRequired,
  isGoogleTemporarilyUnavailable,
} from './GoogleService';

export interface ChannelDataResult {
  title: string | null;
  id: string | null;
  subscribers: string | null;
  videoCount: string | null;
  viewCount: string | null;
  country: string | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  integration: {
    state: OperationalState;
    stale: boolean;
    lastSuccessAt: Date | null;
    summary: string;
  };
}

type ChannelProvider = Pick<ChannelService, 'getChannelInfo'>;
type ChannelProfiles = Pick<ChannelProfileService, 'getActive' | 'connectObservedChannel'>;
type ChannelRuntime = { google: GoogleService; provider: ChannelProvider };

const empty = (state: OperationalState, summary: string): ChannelDataResult => ({
  title: null,
  id: null,
  subscribers: null,
  videoCount: null,
  viewCount: null,
  country: null,
  publishedAt: null,
  thumbnailUrl: null,
  integration: { state, stale: false, lastSuccessAt: null, summary },
});

const fromSnapshot = (
  snapshot: ChannelSnapshot,
  state: OperationalState,
  stale: boolean,
  summary: string,
): ChannelDataResult => ({
  title: snapshot.title,
  id: snapshot.channelId,
  subscribers: snapshot.subscriberCount,
  videoCount: snapshot.videoCount,
  viewCount: snapshot.viewCount,
  country: snapshot.country,
  publishedAt: snapshot.publishedAt?.toISOString() ?? null,
  thumbnailUrl: null,
  integration: { state, stale, lastSuccessAt: snapshot.collectedAt, summary },
});

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

export class ChannelDataService {
  constructor(
    private readonly google = new GoogleService(),
    private readonly snapshots = new ChannelSnapshotRepository(DatabaseService.client),
    private readonly provider: ChannelProvider = new ChannelService(),
    private readonly profiles: ChannelProfiles = new ChannelProfileService(),
    private readonly connectionRuntime = (): ChannelRuntime => {
      const google = new GoogleService(undefined, true);
      return { google, provider: new ChannelService(google) };
    },
  ) {}

  async getChannel(
    options: { refresh?: boolean; connectActiveProfile?: boolean } = {},
    runtime: ChannelRuntime = { google: this.google, provider: this.provider },
  ): Promise<ChannelDataResult> {
    const refresh = options.refresh !== false;
    const activeProfile = await this.profiles.getActive();
    const latest = await this.snapshots.findLatest(activeProfile?.id);

    if (activeProfile && !activeProfile.youtubeChannelId && !options.connectActiveProfile) {
      return empty('DEGRADED', 'Este perfil ainda não está vinculado a uma conta do YouTube.');
    }

    if (!runtime.google.isConfigured()) {
      return latest
        ? fromSnapshot(latest, 'DEGRADED', true, 'Configuração do Google ausente; exibindo o último dado válido.')
        : empty('NOT_CONFIGURED', 'A integração Google ainda não foi configurada.');
    }
    if (!runtime.google.isAuthenticated()) {
      return latest
        ? fromSnapshot(latest, 'AUTH_REQUIRED', true, 'Reconexão Google necessária; exibindo o último dado válido.')
        : empty('AUTH_REQUIRED', 'Conecte novamente a conta Google.');
    }
    if (!refresh) {
      return latest
        ? fromSnapshot(latest, 'CONNECTED', false, 'Último dado persistido do canal.')
        : empty('CONNECTED', 'Google conectado; dados do canal ainda não foram coletados.');
    }

    try {
      const channel = await runtime.provider.getChannelInfo();
      const channelId = text(channel.id);
      const title = text(channel.title);
      if (!channelId || !title) throw new Error('Channel data is incomplete');
      if (activeProfile?.youtubeChannelId && activeProfile.youtubeChannelId !== channelId) {
        throw new ChannelProfileConflictError('the authorized YouTube channel belongs to a different profile');
      }
      if (activeProfile && options.connectActiveProfile) {
        await this.profiles.connectObservedChannel(activeProfile.id, {
          id: channelId,
          title,
          thumbnailUrl: text(channel.thumbnailUrl),
        });
      }
      const saved = await this.snapshots.upsert({
        channelProfileId: activeProfile?.id ?? null,
        channelId,
        title,
        subscriberCount: text(channel.subscribers),
        videoCount: text(channel.videoCount),
        viewCount: text(channel.viewCount),
        country: text(channel.country),
        publishedAt: text(channel.publishedAt) ? new Date(String(channel.publishedAt)) : null,
        collectedAt: new Date(),
      });
      return { ...fromSnapshot(saved, 'CONNECTED', false, 'Canal conectado e atualizado.'), thumbnailUrl: text(channel.thumbnailUrl) };
    } catch (error) {
      const authRequired = isGoogleReauthenticationRequired(error);
      if (authRequired) runtime.google.markReauthenticationRequired();
      const temporary = isGoogleTemporarilyUnavailable(error);
      const profileMismatch = error instanceof ChannelProfileConflictError;
      const state: OperationalState = authRequired ? 'AUTH_REQUIRED' : temporary || profileMismatch ? 'DEGRADED' : 'ERROR';
      const summary = authRequired
        ? 'Reconexão Google necessária.'
        : profileMismatch
          ? 'A conta Google conectada pertence a outro perfil de canal.'
        : temporary
          ? 'YouTube temporariamente indisponível.'
          : 'Não foi possível atualizar os dados do canal.';
      const cachedState: OperationalState = authRequired ? 'AUTH_REQUIRED' : 'DEGRADED';
      return latest ? fromSnapshot(latest, cachedState, true, `${summary} Exibindo o último dado válido.`) : empty(state, summary);
    }
  }

  async connectActiveProfile(): Promise<ChannelDataResult> {
    const active = await this.profiles.getActive();
    if (!active) throw new ChannelProfileConflictError('no active channel profile');
    if (active.youtubeChannelId) return this.getChannel({ refresh: true, connectActiveProfile: true });

    // An unlinked profile must be authorized explicitly. It may not claim the legacy token of another channel.
    return this.getChannel(
      { refresh: true, connectActiveProfile: true },
      this.connectionRuntime(),
    );
  }
}
