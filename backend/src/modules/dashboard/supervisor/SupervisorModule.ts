import { YouTubePerformanceSyncService } from '../../../services/performance-intelligence/YouTubePerformanceSyncService';

export class SupervisorModule {
  constructor(private readonly youtubeSyncService = new YouTubePerformanceSyncService()) {}

  async getSupervisorOverview() {
    let youtubeAnalytics;
    try {
      youtubeAnalytics = await this.youtubeSyncService.getStatus();
    } catch {
      youtubeAnalytics = {
        state: 'temporary_error',
        lastSyncAt: null,
        lastErrorType: 'temporary',
      };
    }
    return {
      alerts: [],
      issues: [],
      youtubeAnalytics,
    };
  }
}
