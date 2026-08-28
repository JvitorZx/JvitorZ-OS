import { DatabaseService } from '../database/DatabaseService';
import type { IntegrationState, OperationalState } from '../domains/integrations/OperationalState';
import { automationRuntime, type AutomationRuntimeService } from './automation/AutomationRuntimeService';
import { ChannelDataService, type ChannelDataResult } from './ChannelDataService';
import { GoogleService } from './GoogleService';
import {
  YouTubePerformanceSyncService,
  youtubePerformanceSyncService,
  type YouTubeAnalyticsProviderStatus,
} from './performance-intelligence/YouTubePerformanceSyncService';

export type IntegrationStatusMap = Record<IntegrationState['id'], IntegrationState>;

const status = (
  id: IntegrationState['id'],
  state: OperationalState,
  summary: string,
  options: Partial<Pick<IntegrationState, 'configured' | 'available' | 'stale' | 'lastSuccessAt' | 'action'>> = {},
): IntegrationState => ({
  id,
  state,
  configured: options.configured ?? state !== 'NOT_CONFIGURED',
  available: options.available ?? (state === 'CONNECTED' || state === 'DEGRADED'),
  stale: options.stale ?? false,
  summary,
  lastSuccessAt: options.lastSuccessAt ?? null,
  action: options.action ?? null,
});

const analyticsStatus = (value: YouTubeAnalyticsProviderStatus): IntegrationState => {
  if (value.state === 'not_configured') {
    return status('youtubeAnalytics', 'NOT_CONFIGURED', 'YouTube Analytics não configurado.', {
      configured: false, available: false, action: 'CONFIGURE',
    });
  }
  if (value.state === 'not_authorized') {
    return status('youtubeAnalytics', 'AUTH_REQUIRED', 'Autorização Google necessária para Analytics.', {
      available: false, lastSuccessAt: value.lastSyncAt, stale: Boolean(value.lastSyncAt), action: 'RECONNECT',
    });
  }
  if (value.state === 'temporary_error') {
    return status('youtubeAnalytics', value.lastSyncAt ? 'DEGRADED' : 'ERROR',
      value.lastSyncAt ? 'Analytics temporariamente indisponível; os últimos snapshots foram preservados.' : 'Analytics temporariamente indisponível.', {
        available: Boolean(value.lastSyncAt), lastSuccessAt: value.lastSyncAt, stale: Boolean(value.lastSyncAt), action: 'SYNC',
      });
  }
  return status('youtubeAnalytics', 'CONNECTED', value.lastSyncAt
    ? 'YouTube Analytics sincronizado.'
    : 'YouTube Analytics conectado; ainda sem snapshots.', {
      lastSuccessAt: value.lastSyncAt, action: 'SYNC',
    });
};

export class IntegrationStatusService {
  constructor(
    private readonly google = new GoogleService(),
    private readonly channel = new ChannelDataService(),
    private readonly analytics: Pick<YouTubePerformanceSyncService, 'getStatus'> = youtubePerformanceSyncService,
    private readonly runtime: Pick<AutomationRuntimeService, 'getHealth'> = automationRuntime,
    private readonly database = DatabaseService.client,
  ) {}

  async getAll(preloaded: { channel?: ChannelDataResult; analytics?: YouTubeAnalyticsProviderStatus } = {}): Promise<IntegrationStatusMap> {
    const googleState = this.google.getAuthenticationState();
    const channelData = preloaded.channel ?? await this.channel.getChannel({ refresh: false });
    const analytics = preloaded.analytics ?? await this.analytics.getStatus();
    const runtime = this.runtime.getHealth();
    let databaseState: IntegrationState;
    try {
      await this.database.$queryRawUnsafe('SELECT 1');
      databaseState = status('database', 'CONNECTED', 'SQLite disponível.', { available: true });
    } catch {
      databaseState = status('database', 'ERROR', 'Banco de dados indisponível.', { available: false });
    }

    const googleOAuth = googleState === 'CONNECTED'
      ? status('googleOAuth', 'CONNECTED', 'Google OAuth conectado.', { action: 'RECONNECT' })
      : googleState === 'AUTH_REQUIRED'
        ? status('googleOAuth', 'AUTH_REQUIRED', 'Conecte ou reconecte a conta Google.', { available: false, action: 'CONNECT' })
        : status('googleOAuth', 'NOT_CONFIGURED', 'Credenciais OAuth do Google não configuradas.', { configured: false, available: false, action: 'CONFIGURE' });

    const youtubeData = status('youtubeData', channelData.integration.state, channelData.integration.summary, {
      configured: googleState !== 'NOT_CONFIGURED',
      available: Boolean(channelData.id),
      stale: channelData.integration.stale,
      lastSuccessAt: channelData.integration.lastSuccessAt,
      action: channelData.integration.state === 'CONNECTED' ? null : googleState === 'CONNECTED' ? 'SYNC' : 'RECONNECT',
    });

    const openaiConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());
    const openai = openaiConfigured
      ? status('openai', 'CONNECTED', 'OpenAI configurada; disponibilidade é validada ao gerar uma resposta.')
      : status('openai', 'NOT_CONFIGURED', 'OpenAI não configurada.', { configured: false, available: false, action: 'CONFIGURE' });

    const automationRuntime = !runtime.enabled
      ? status('automationRuntime', 'NOT_CONFIGURED', 'Runtime de automações desativado por configuração.', { configured: false, available: false, action: 'CONFIGURE' })
      : runtime.status === 'ERROR'
        ? status('automationRuntime', 'ERROR', 'Runtime de automações com falha.', { available: false })
        : runtime.status === 'RUNNING'
          ? status('automationRuntime', 'CONNECTED', 'Runtime de automações em execução.', { lastSuccessAt: runtime.lastSuccessfulTickAt ? new Date(runtime.lastSuccessfulTickAt) : null })
          : status('automationRuntime', 'DEGRADED', 'Runtime configurado, mas parado.', { available: true });

    return {
      backend: status('backend', 'CONNECTED', 'Backend API disponível.'),
      database: databaseState,
      googleOAuth,
      youtubeData,
      youtubeAnalytics: analyticsStatus(analytics),
      openai,
      automationRuntime,
    };
  }
}
