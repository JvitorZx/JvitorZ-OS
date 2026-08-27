import type { EditorialDecision } from '@prisma/client';
import { YouTubePerformanceSyncService } from '../../../services/performance-intelligence/YouTubePerformanceSyncService';
import { EditorialDecisionService } from '../../../services/creator-intelligence/EditorialDecisionService';
import { OutcomeRefreshService } from '../../../services/creator-intelligence/OutcomeRefreshService';
import { PlanReviewService } from '../../../services/orchestration/PlanReviewService';
import { DatabaseService } from '../../../database/DatabaseService';
import { AutomationRepository } from '../../../database/repositories/AutomationRepository';
import { AutomationRunRepository } from '../../../database/repositories/AutomationRunRepository';
import { automationRuntime, type AutomationRuntimeService } from '../../../services/automation/AutomationRuntimeService';
import { AutomationDiagnosticsService } from '../../../services/automation/AutomationDiagnosticsService';

export class SupervisorModule {
  constructor(
    private readonly youtubeSyncService = new YouTubePerformanceSyncService(),
    private readonly editorialDecisionService = new EditorialDecisionService(),
    private readonly outcomeRefreshService = new OutcomeRefreshService(),
    private readonly planReviewService = new PlanReviewService(),
    private readonly automationRepository = new AutomationRepository(DatabaseService.client),
    private readonly automationRunRepository = new AutomationRunRepository(DatabaseService.client),
    private readonly automationRuntimeService: Pick<AutomationRuntimeService, 'getHealth'> = automationRuntime,
    private readonly automationDiagnosticsService = new AutomationDiagnosticsService(),
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
    let orchestrationReviews = {
      awaitingReview: 0,
      approved: 0,
      rejected: 0,
      expired: 0,
      executedRecently: 0,
      blockedRecently: 0,
    };
    try {
      orchestrationReviews = await this.planReviewService.getOperationalSummary();
    } catch {
      // Plan review is an operational section and must not break the Dashboard.
    }
    let automations = { total: 0, active: 0, paused: 0, blocked: 0, error: 0, due: 0 };
    try {
      automations = await this.automationRepository.getOperationalSummary();
    } catch {
      // Automation status is local and must not break the Dashboard.
    }
    let automationRuntimeHealth = this.automationRuntimeService.getHealth();
    let running = 0;
    try { running = await this.automationRunRepository.countByStatuses(['PENDING', 'RUNNING']); } catch { running = 0; }
    let governance = { healthy: 0, degraded: 0, blocked: 0, failing: 0, disabled: 0, quotasReached: 0, pausedByFailure: 0, approvalsPending: 0, retriesPending: 0 };
    try { governance = await this.automationDiagnosticsService.getSummary(); } catch { /* Local diagnostics must not break Dashboard. */ }
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
      orchestrationReviews,
      automations: { ...automations, running, runtime: automationRuntimeHealth, governance },
    };
  }
}
