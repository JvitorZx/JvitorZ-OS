import type { EditorialDecision } from '@prisma/client';
import {
  YouTubePerformanceSyncService,
  youtubePerformanceSyncService,
  type YouTubeAnalyticsProviderStatus,
} from '../../../services/performance-intelligence/YouTubePerformanceSyncService';
import { EditorialDecisionService } from '../../../services/creator-intelligence/EditorialDecisionService';
import { OutcomeRefreshService } from '../../../services/creator-intelligence/OutcomeRefreshService';
import { PlanReviewService } from '../../../services/orchestration/PlanReviewService';
import { DatabaseService } from '../../../database/DatabaseService';
import { AutomationRepository } from '../../../database/repositories/AutomationRepository';
import { AutomationRunRepository } from '../../../database/repositories/AutomationRunRepository';
import { automationRuntime, type AutomationRuntimeService } from '../../../services/automation/AutomationRuntimeService';
import { AutomationDiagnosticsService } from '../../../services/automation/AutomationDiagnosticsService';
import { ChannelOperatorService } from '../../../services/channel-operators';
import {
  YouTubeReachSyncService,
  youtubeReachSyncService,
  type YouTubeReachStatus,
} from '../../../services/performance-intelligence/YouTubeReachSyncService';
import { AudienceIntelligenceService } from '../../../services/audience/AudienceIntelligenceService';
import { OrchestrationExecutionRepository } from '../../../database/repositories/OrchestrationExecutionRepository';
import type { OrchestrationRequest, OrchestrationResult } from '../../../domains/orchestration';

const operatorSummary = (operator: { id: string; status: string; missingData: string[]; sampleSize: number }): string => {
  if (operator.status === 'AVAILABLE') {
    return `${operator.id} disponível com ${operator.sampleSize} item(ns) na amostra.`;
  }
  if (operator.status === 'LIMITED') {
    return `${operator.id} limitado: faltam ${operator.missingData.join(', ')}.`;
  }
  return `${operator.id} ainda sem dados sincronizados suficientes.`;
};

export class SupervisorModule {
  constructor(
    private readonly youtubeSyncService = youtubePerformanceSyncService,
    private readonly editorialDecisionService = new EditorialDecisionService(),
    private readonly outcomeRefreshService = new OutcomeRefreshService(),
    private readonly planReviewService = new PlanReviewService(),
    private readonly automationRepository = new AutomationRepository(DatabaseService.client),
    private readonly automationRunRepository = new AutomationRunRepository(DatabaseService.client),
    private readonly automationRuntimeService: Pick<AutomationRuntimeService, 'getHealth'> = automationRuntime,
    private readonly automationDiagnosticsService = new AutomationDiagnosticsService(),
    private readonly channelOperatorService = new ChannelOperatorService(),
    private readonly youtubeReachService: Pick<YouTubeReachSyncService, 'getStatus'> = youtubeReachSyncService,
    private readonly audienceIntelligence: Pick<AudienceIntelligenceService, 'summary'> = new AudienceIntelligenceService(),
    private readonly orchestrationRepository = new OrchestrationExecutionRepository(DatabaseService.client),
  ) {}

  async getSupervisorOverview() {
    let youtubeAnalytics: YouTubeAnalyticsProviderStatus;
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
    let audience: Awaited<ReturnType<AudienceIntelligenceService['summary']>> | null = null;
    try { audience = await this.audienceIntelligence.summary(); } catch { audience = null; }
    let youtubeReach: YouTubeReachStatus;
    try { youtubeReach = await this.youtubeReachService.getStatus(); }
    catch {
      youtubeReach = { state: 'temporary_error', reportTypeId: 'channel_reach_basic_a1', jobId: null, lastReportAt: null, lastSyncAt: null, lastErrorType: 'temporary', quality: { state: 'ERROR', availability: 0, freshness: 'MISSING', completeness: 0, consistency: 0, sampleSize: 0, sourceReliability: 1, latestCollectedAt: null, latestPeriodEnd: null, reasons: [{ code: 'STATUS_ERROR', message: 'Qualidade de alcance indisponível.', severity: 'error' }] } };
    }
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
    const risks = [...new Set(recentDecisions.flatMap((decision) => {
      const legacy = Array.isArray(decision.risks) ? decision.risks.filter((risk): risk is string => typeof risk === 'string') : [];
      const opportunity = decision.opportunityScore && typeof decision.opportunityScore === 'object' && !Array.isArray(decision.opportunityScore)
        ? decision.opportunityScore as Record<string, unknown> : null;
      const structured = Array.isArray(opportunity?.risks) ? opportunity.risks.flatMap((risk) => {
        if (!risk || typeof risk !== 'object' || Array.isArray(risk)) return [];
        const summary = (risk as Record<string, unknown>).summary;
        return typeof summary === 'string' ? [summary] : [];
      }) : [];
      return [...legacy, ...structured];
    }))].slice(0, 5);
    const opportunities = recentDecisions.flatMap((decision) => {
      if (!Array.isArray(decision.alternatives)) return [];
      return decision.alternatives.flatMap((alternative) => {
        if (typeof alternative === 'string') return [alternative];
        if (!alternative || typeof alternative !== 'object' || Array.isArray(alternative)) return [];
        const value = alternative as Record<string, unknown>;
        const ideaId = typeof value.ideaId === 'string' ? value.ideaId : null;
        const candidateKey = typeof value.candidateKey === 'string' ? value.candidateKey : null;
        const label = typeof value.label === 'string' ? value.label : candidateKey;
        const rationale = typeof value.rationale === 'string' ? value.rationale : null;
        if (!rationale || (!ideaId && !label)) return [];
        return [ideaId ? `Ideia ${ideaId}: ${rationale}` : `${label}: ${rationale}`];
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
    let managerOrchestration = {
      recent: 0,
      degraded: 0,
      lowConfidence: 0,
      insufficientData: 0,
      conflicts: 0,
      operators: [] as string[],
    };
    try {
      const executions = (await this.orchestrationRepository.findRecent({ limit: 20 }))
        .filter((execution) => Boolean((execution.request as unknown as OrchestrationRequest).managerIntent));
      const results = executions.flatMap((execution) => execution.result
        ? [execution.result as unknown as OrchestrationResult] : []);
      managerOrchestration = {
        recent: executions.length,
        degraded: results.filter(({ status }) => status !== 'completed').length,
        lowConfidence: results.filter(({ evidence }) => evidence.confidence < 0.5).length,
        insufficientData: results.filter(({ outcome }) => outcome === 'INSUFFICIENT_DATA').length,
        conflicts: results.reduce((sum, result) => sum + (result.conflicts?.length ?? 0), 0),
        operators: [...new Set(results.flatMap((result) =>
          (result.operatorInvocations ?? []).map(({ operatorId }) => operatorId)))].slice(0, 12),
      };
    } catch {
      // Manager history is diagnostic and must not break the Supervisor.
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
    let channelOperators: Array<{ id: string; status: string; confidence: number; sampleSize: number; missingData: string[]; summary: string; signals: string[] }> = [];
    try {
      channelOperators = (await this.channelOperatorService.list()).map((operator) => ({
        id: operator.id,
        status: operator.status,
        confidence: operator.confidence,
        sampleSize: operator.sampleSize,
        missingData: operator.missingData,
        summary: operatorSummary(operator),
        signals: (operator.signals ?? []).map(({ summary }) => summary).slice(0, 5),
      }));
    } catch { /* Specialized read models must not break the Supervisor. */ }
    const byId = new Map(channelOperators.map((operator) => [operator.id, operator]));
    const analyticsQuality = youtubeAnalytics.state === 'synchronized' || youtubeAnalytics.state === 'connected' ? 'GOOD'
      : youtubeAnalytics.lastSyncAt ? 'STALE' : youtubeAnalytics.state === 'temporary_error' ? 'ERROR' : 'MISSING';
    const dataQuality = [
      { area: 'Analytics', state: analyticsQuality, summary: analyticsQuality === 'GOOD' ? 'Snapshots Analytics disponíveis.' : 'Analytics requer atenção ou sincronização.' },
      { area: 'Alcance', state: youtubeReach.quality.state, summary: youtubeReach.quality.reasons[0]?.message ?? 'Impressões e CTR com qualidade adequada.' },
      { area: 'Retenção', state: byId.get('retention')?.status === 'AVAILABLE' ? 'GOOD' : byId.get('retention')?.status === 'LIMITED' ? 'PARTIAL' : 'MISSING', summary: byId.get('retention')?.summary ?? 'Retenção sem dados.' },
      { area: 'Tipo de conteúdo', state: byId.get('long-form')?.sampleSize || byId.get('shorts')?.sampleSize ? 'GOOD' : 'MISSING', summary: 'Classificação real de long-form e Shorts.' },
      { area: 'Audiência', state: audience?.quality.state ?? 'MISSING', summary: audience?.facts[0] ?? 'Audiência e fontes de tráfego ainda sem dados.' },
    ];
    return {
      alerts: dataQuality.filter(({ state }) => ['STALE', 'INCONSISTENT', 'ERROR'].includes(state)).map(({ area, summary }) => `${area}: ${summary}`),
      issues: [],
      youtubeAnalytics,
      youtubeReach,
      dataQuality,
      editorial: {
        decisions: recentDecisions.map((decision) => ({
          id: decision.id,
          recommendation: decision.recommendation,
          category: decision.category,
          score: decision.score,
          confidence: decision.confidence,
          candidateType: decision.candidateType,
          candidateKey: decision.candidateKey,
          nextAction: decision.nextAction,
          createdAt: decision.createdAt,
        })),
        priorities: recentDecisions.filter(({ category }) => ['PRIORITIZE', 'CONTINUE', 'TEST'].includes(category))
          .slice(0, 3).map(({ recommendation }) => recommendation),
        risks,
        opportunities,
        actions: recentDecisions.slice(0, 3).map(({ nextAction }) => nextAction),
        insufficientData: recentDecisions.filter(({ category }) => category === 'INSUFFICIENT_DATA').length,
        conflictingSignals: recentDecisions.filter((decision) => decision.category === 'REEVALUATE').length,
      },
      outcomeReviews,
      orchestrationReviews,
      managerOrchestration,
      automations: { ...automations, running, runtime: automationRuntimeHealth, governance },
      channelOperators,
      temporalIntelligence: {
        trends: byId.get('trends') ?? null,
        series: byId.get('series') ?? null,
        highlights: [...(byId.get('trends')?.signals ?? []), ...(byId.get('series')?.signals ?? [])].slice(0, 6),
      },
      audience,
    };
  }
}
