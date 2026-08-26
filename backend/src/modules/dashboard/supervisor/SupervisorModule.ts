import type { EditorialDecision } from '@prisma/client';
import { YouTubePerformanceSyncService } from '../../../services/performance-intelligence/YouTubePerformanceSyncService';
import { EditorialDecisionService } from '../../../services/creator-intelligence/EditorialDecisionService';
import { OutcomeRefreshService } from '../../../services/creator-intelligence/OutcomeRefreshService';

export class SupervisorModule {
  constructor(
    private readonly youtubeSyncService = new YouTubePerformanceSyncService(),
    private readonly editorialDecisionService = new EditorialDecisionService(),
    private readonly outcomeRefreshService = new OutcomeRefreshService(),
  ) {}

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
    let recentDecisions: EditorialDecision[] = [];
    try {
      recentDecisions = await this.editorialDecisionService.list({ limit: 5 });
    } catch {
      recentDecisions = [];
    }
    let outcomeReviews = {
      current: 0,
      reviewAvailable: 0,
      stale: 0,
      insufficientData: 0,
      recentFailures: 0,
    };
    try {
      outcomeReviews = await this.outcomeRefreshService.getOperationalStatus();
    } catch {
      // Outcome review is a local operational section and must not break the Dashboard.
    }
    const risks = [...new Set(recentDecisions.flatMap((decision) => (
      Array.isArray(decision.risks) ? decision.risks.filter((risk): risk is string => typeof risk === 'string') : []
    )))].slice(0, 5);
    const opportunities = recentDecisions.flatMap((decision) => {
      if (!Array.isArray(decision.alternatives)) return [];
      return decision.alternatives.flatMap((alternative) => {
        if (typeof alternative === 'string') return [alternative];
        if (!alternative || typeof alternative !== 'object' || Array.isArray(alternative)) return [];
        const value = alternative as Record<string, unknown>;
        const ideaId = typeof value.ideaId === 'string' ? value.ideaId : null;
        const rationale = typeof value.rationale === 'string' ? value.rationale : null;
        if (!ideaId || !rationale) return [];
        return [`Ideia ${ideaId}: ${rationale}`];
      });
    }).slice(0, 5);
    return {
      alerts: [],
      issues: [],
      youtubeAnalytics,
      editorial: {
        decisions: recentDecisions.map((decision) => ({
          id: decision.id,
          recommendation: decision.recommendation,
          confidence: decision.confidence,
          nextAction: decision.nextAction,
          createdAt: decision.createdAt,
        })),
        priorities: recentDecisions.slice(0, 3).map(({ recommendation }) => recommendation),
        risks,
        opportunities,
        actions: recentDecisions.slice(0, 3).map(({ nextAction }) => nextAction),
      },
      outcomeReviews,
    };
  }
}
