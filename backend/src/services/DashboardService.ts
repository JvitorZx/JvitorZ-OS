import { ChannelModule } from '../modules/dashboard/canal/ChannelModule';
import { AnalyticsModule } from '../modules/dashboard/analytics/AnalyticsModule';
import { OperatorsModule } from '../modules/dashboard/operadores/OperatorsModule';
import { SupervisorModule } from '../modules/dashboard/supervisor/SupervisorModule';
import { SettingsModule } from '../modules/dashboard/configuracoes/SettingsModule';
import { DatabaseService } from '../database/DatabaseService';
import { AutomationRepository } from '../database/repositories/AutomationRepository';
import { IntegrationStatusService } from './IntegrationStatusService';
import { ChannelProfileService } from './ChannelProfileService';

const EMPTY_CHANNEL_SCOPE = '__no-active-channel-workspace__';

export class DashboardService {
  constructor(
    private readonly channelModule = new ChannelModule(),
    private readonly analyticsModule = new AnalyticsModule(),
    private readonly operatorsModule = new OperatorsModule(),
    private readonly supervisorModule = new SupervisorModule(),
    private readonly settingsModule = new SettingsModule(),
    private readonly automationRepository = new AutomationRepository(DatabaseService.client),
    private readonly integrationStatusService = new IntegrationStatusService(),
    private readonly channelProfiles: Pick<ChannelProfileService, 'getActive'> = new ChannelProfileService(),
  ) {}

  async getDashboard({ youtubeConnected = true }: { youtubeConnected?: boolean } = {}): Promise<Record<string, unknown>> {
    const activeProfile = await this.channelProfiles.getActive().catch(() => null);
    const projectId = !activeProfile
      ? undefined
      : activeProfile.projectId ?? (activeProfile.usesLegacyWorkspaceData ? null : EMPTY_CHANNEL_SCOPE);
    const [channel, analytics, operators, supervisor, settings, automationSummary] = await Promise.all([
      this.channelModule.getChannelSummary({ refresh: youtubeConnected }),
      this.analyticsModule.getDashboardAnalytics(),
      this.operatorsModule.getOperatorsStatus(projectId),
      this.supervisorModule.getSupervisorOverview(projectId),
      this.settingsModule.getSettings(),
      this.automationRepository.getOperationalSummary(),
    ]);
    const integrations = await this.integrationStatusService.getAll({
      channel,
      analytics: supervisor.youtubeAnalytics,
    });
    const dataQuality = [
      {
        area: 'Canal',
        state: channel.integration.state === 'CONNECTED' && !channel.integration.stale ? 'GOOD' : channel.id ? 'STALE' : 'MISSING',
        summary: channel.integration.summary,
      },
      ...(supervisor.dataQuality ?? []),
    ];

    return {
      channel,
      analytics,
      operators,
      supervisor: { ...supervisor, dataQuality },
      settings,
      integrations,
      dataQuality,
      metrics: {
        subscribers: channel.subscribers,
        videos: channel.videoCount,
        views: channel.viewCount,
      },
      status: {
        youtubeConnected: integrations.youtubeData.state === 'CONNECTED',
        automationsEnabled: automationSummary.active > 0,
        aiEnabled: integrations.openai.state === 'CONNECTED',
      },
    };
  }
}
