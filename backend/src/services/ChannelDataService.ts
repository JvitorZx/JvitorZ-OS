import type { ChannelSnapshot } from '@prisma/client';
import { DatabaseService } from '../database/DatabaseService';
import { ChannelSnapshotRepository } from '../database/repositories/ChannelSnapshotRepository';
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
  integration: {
    state: OperationalState;
    stale: boolean;
    lastSuccessAt: Date | null;
    summary: string;
  };
}

type ChannelProvider = Pick<ChannelService, 'getChannelInfo'>;

const empty = (state: OperationalState, summary: string): ChannelDataResult => ({
  title: null,
  id: null,
  subscribers: null,
  videoCount: null,
  viewCount: null,
  country: null,
  publishedAt: null,
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
  integration: { state, stale, lastSuccessAt: snapshot.collectedAt, summary },
});

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

export class ChannelDataService {
  constructor(
    private readonly google = new GoogleService(),
    private readonly snapshots = new ChannelSnapshotRepository(DatabaseService.client),
    private readonly provider: ChannelProvider = new ChannelService(),
  ) {}

  async getChannel(options: { refresh?: boolean } = {}): Promise<ChannelDataResult> {
    const refresh = options.refresh !== false;
    const latest = await this.snapshots.findLatest();

    if (!this.google.isConfigured()) {
      return latest
        ? fromSnapshot(latest, 'DEGRADED', true, 'Configuração do Google ausente; exibindo o último dado válido.')
        : empty('NOT_CONFIGURED', 'A integração Google ainda não foi configurada.');
    }
    if (!this.google.isAuthenticated()) {
      return latest
        ? fromSnapshot(latest, 'DEGRADED', true, 'Reconexão Google necessária; exibindo o último dado válido.')
        : empty('AUTH_REQUIRED', 'Conecte novamente a conta Google.');
    }
    if (!refresh) {
      return latest
        ? fromSnapshot(latest, 'CONNECTED', false, 'Último dado persistido do canal.')
        : empty('CONNECTED', 'Google conectado; dados do canal ainda não foram coletados.');
    }

    try {
      const channel = await this.provider.getChannelInfo();
      const channelId = text(channel.id);
      const title = text(channel.title);
      if (!channelId || !title) throw new Error('Channel data is incomplete');
      const saved = await this.snapshots.upsert({
        channelId,
        title,
        subscriberCount: text(channel.subscribers),
        videoCount: text(channel.videoCount),
        viewCount: text(channel.viewCount),
        country: text(channel.country),
        publishedAt: text(channel.publishedAt) ? new Date(String(channel.publishedAt)) : null,
        collectedAt: new Date(),
      });
      return fromSnapshot(saved, 'CONNECTED', false, 'Canal conectado e atualizado.');
    } catch (error) {
      const authRequired = isGoogleReauthenticationRequired(error);
      const temporary = isGoogleTemporarilyUnavailable(error);
      const state: OperationalState = authRequired ? 'AUTH_REQUIRED' : temporary ? 'DEGRADED' : 'ERROR';
      const summary = authRequired
        ? 'Reconexão Google necessária.'
        : temporary
          ? 'YouTube temporariamente indisponível.'
          : 'Não foi possível atualizar os dados do canal.';
      return latest ? fromSnapshot(latest, 'DEGRADED', true, `${summary} Exibindo o último dado válido.`) : empty(state, summary);
    }
  }
}
