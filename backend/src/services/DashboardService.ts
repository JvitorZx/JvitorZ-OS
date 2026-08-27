import { ChannelModule } from '../modules/dashboard/canal/ChannelModule';
import { AnalyticsModule } from '../modules/dashboard/analytics/AnalyticsModule';
import { OperatorsModule } from '../modules/dashboard/operadores/OperatorsModule';
import { SupervisorModule } from '../modules/dashboard/supervisor/SupervisorModule';
import { SettingsModule } from '../modules/dashboard/configuracoes/SettingsModule';
import { DatabaseService } from '../database/DatabaseService';
import { AutomationRepository } from '../database/repositories/AutomationRepository';

export class DashboardService {
  private channelModule = new ChannelModule();
  private analyticsModule = new AnalyticsModule();
  private operatorsModule = new OperatorsModule();
  private supervisorModule = new SupervisorModule();
  private settingsModule = new SettingsModule();
  private automationRepository = new AutomationRepository(DatabaseService.client);

  async getDashboard(): Promise<Record<string, unknown>> {
    const channel = await this.channelModule.getChannelSummary();
    const analytics = await this.analyticsModule.getDashboardAnalytics();
    const operators = await this.operatorsModule.getOperatorsStatus();
    const supervisor = await this.supervisorModule.getSupervisorOverview();
    const settings = await this.settingsModule.getSettings();
    const automationSummary = await this.automationRepository.getOperationalSummary();

    return {
      channel,
      analytics,
      operators,
      supervisor,
      settings,
      metrics: {
        subscribers: channel.subscribers,
        videos: channel.videoCount,
        views: channel.viewCount,
      },
      status: {
        youtubeConnected: true,
        automationsEnabled: automationSummary.active > 0,
        aiEnabled: Boolean(process.env.OPENAI_API_KEY?.trim()),
      },
    };
  }
}
