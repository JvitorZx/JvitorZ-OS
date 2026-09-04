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
import { ResearchService } from '../../../services/research';
import { StrategicPlanningService } from '../../../services/strategic-planning';
import { ExperimentationService } from '../../../services/strategic-experimentation';
import { StrategicMonitoringService } from '../../../services/strategic-monitoring';
import { ChannelContextResolver } from '../../../services/channel-context';
import { PackagingService } from '../../../services/packaging';
import { ProductionRepository } from '../../../database/repositories/ProductionRepository';

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
    private readonly researchService: Pick<ResearchService, 'getOperationalSummary'> = new ResearchService(),
    private readonly strategicPlanningService: Pick<StrategicPlanningService, 'getOperationalSummary'> = new StrategicPlanningService(),
    private readonly experimentationService: Pick<ExperimentationService, 'getOperationalSummary'> = new ExperimentationService(),
    private readonly strategicMonitoringService: Pick<StrategicMonitoringService, 'getOperationalSummary'> = new StrategicMonitoringService(),
    private readonly channelContextResolver: Pick<ChannelContextResolver, 'resolve'> = new ChannelContextResolver(),
    private readonly packagingService: Pick<PackagingService, 'getOperationalSummary'> = new PackagingService(),
    private readonly productionRepository: Pick<ProductionRepository, 'findAll'> = new ProductionRepository(DatabaseService.client),
  ) {}

  reviewProduction(input: { requiredStepsComplete: boolean; packagingSelected: boolean; packagingReview?: { valid: boolean; findings: Array<{ severity: string; code: string; message: string }> } | null }) {
    const findings = input.packagingReview?.findings ?? [];
    if (!input.requiredStepsComplete) return { outcome: 'BLOCKED' as const, findings: ['Etapas obrigatorias anteriores ainda nao foram concluidas.'] };
    if (!input.packagingSelected) return { outcome: 'NEEDS_CHANGES' as const, findings: ['Selecione uma variante de Packaging antes da revisao.'] };
    if (input.packagingReview && !input.packagingReview.valid) return { outcome: 'NEEDS_CHANGES' as const, findings: findings.map(({ message }) => message) };
    const warnings = findings.filter(({ severity }) => severity === 'WARNING').map(({ message }) => message);
    return { outcome: warnings.length ? 'APPROVED_WITH_WARNINGS' as const : 'APPROVED' as const, findings: warnings };
  }

  reviewChapters(input: { durationMs?: number | null; entries: Array<{ startMs: number; title: string; segmentStartPosition: number; segmentEndPosition: number }> }) {
    const findings: string[] = [];
    if (!input.entries.length) findings.push('A versao nao possui capitulos.');
    if (input.entries.length > 20) findings.push('A versao possui capitulos em excesso para revisao humana.');
    input.entries.forEach((entry, index) => {
      if (entry.startMs < 0 || (index > 0 && entry.startMs <= input.entries[index - 1].startMs)) findings.push(`Timestamp invalido no capitulo ${index + 1}.`);
      if (input.durationMs != null && entry.startMs > input.durationMs) findings.push(`Capitulo ${index + 1} inicia alem da duracao conhecida.`);
      if (!entry.title.trim() || entry.title.trim().length > 100) findings.push(`Titulo invalido no capitulo ${index + 1}.`);
      if (entry.segmentStartPosition > entry.segmentEndPosition) findings.push(`Evidencia temporal invalida no capitulo ${index + 1}.`);
    });
    return { outcome: findings.length ? 'NEEDS_CHANGES' as const : 'APPROVED' as const, findings };
  }

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
    let research = {
      totalResearches: 0, opportunities: 0, lowConfidence: 0, stale: 0, conflicts: 0,
      quality: 'MISSING', freshness: 'MISSING', latestAt: null as Date | null, sources: [] as Array<{ id: string; kind: string; freshness: string; quality: string }>,
    };
    try { research = await this.researchService.getOperationalSummary(); }
    catch { /* Research is local and cannot break the Supervisor or Dashboard. */ }
    let planning = {
      planId: null as string | null, status: 'MISSING', horizon: null as string | null,
      total: 0, ready: 0, needsResearch: 0, blocked: 0, lowConfidence: 0,
      experiments: 0, stale: 0, conflicts: 0, alerts: [] as string[],
    };
    try { planning = await this.strategicPlanningService.getOperationalSummary(); }
    catch { /* Strategic planning is local and cannot break the Supervisor or Dashboard. */ }
    let experimentation = { total: 0, active: 0, waitingForData: 0, stale: 0, lowConfidence: 0, inconclusive: 0, contradicted: 0 };
    try { experimentation = await this.experimentationService.getOperationalSummary(); }
    catch { /* Experimentation is local and cannot break the Supervisor or Dashboard. */ }
    let strategicMonitoring = { total: 0, active: 0, high: 0, critical: 0, stale: 0,
      signals: [] as Array<{ id: string; type: string; severity: string; subject: string; summary: string; confidence: number; detectedAt: Date }> };
    try { strategicMonitoring = await this.strategicMonitoringService.getOperationalSummary(); }
    catch { /* Monitoring is local and cannot break the Supervisor or Dashboard. */ }
    let channelContext = { totalCandidates: 0, truncated: false, entries: [] as Array<{ id: string; type: string; status: string; subject: string; statement: string; confidence: number }> };
    try { channelContext = await this.channelContextResolver.resolve({ text: 'estrategia riscos decisoes experimentos plataforma producao', limit: 8, maxCharacters: 4_000 }); }
    catch { /* Creator context is local read-only guidance and cannot break the Supervisor. */ }
    let packaging = { total: 0, selected: 0, published: 0, experiments: 0, needingReview: 0 };
    try { packaging = await this.packagingService.getOperationalSummary(); }
    catch { /* Packaging is local and cannot break the Supervisor or Dashboard. */ }
    let productions: Awaited<ReturnType<ProductionRepository['findAll']>> = [];
    try { productions = await this.productionRepository.findAll({ limit: 100 }); }
    catch { /* Production state is local and cannot break the Supervisor. */ }
    const byId = new Map(channelOperators.map((operator) => [operator.id, operator]));
    const analyticsQuality = youtubeAnalytics.state === 'synchronized' || youtubeAnalytics.state === 'connected' ? 'GOOD'
      : youtubeAnalytics.lastSyncAt ? 'STALE' : youtubeAnalytics.state === 'temporary_error' ? 'ERROR' : 'MISSING';
    const dataQuality = [
      { area: 'Analytics', state: analyticsQuality, summary: analyticsQuality === 'GOOD' ? 'Snapshots Analytics disponíveis.' : 'Analytics requer atenção ou sincronização.' },
      { area: 'Alcance', state: youtubeReach.quality.state, summary: youtubeReach.quality.reasons[0]?.message ?? 'Impressões e CTR com qualidade adequada.' },
      { area: 'Retenção', state: byId.get('retention')?.status === 'AVAILABLE' ? 'GOOD' : byId.get('retention')?.status === 'LIMITED' ? 'PARTIAL' : 'MISSING', summary: byId.get('retention')?.summary ?? 'Retenção sem dados.' },
      { area: 'Tipo de conteúdo', state: byId.get('long-form')?.sampleSize || byId.get('shorts')?.sampleSize ? 'GOOD' : 'MISSING', summary: 'Classificação real de long-form e Shorts.' },
      { area: 'Audiência', state: audience?.quality.state ?? 'MISSING', summary: audience?.facts[0] ?? 'Audiência e fontes de tráfego ainda sem dados.' },
      { area: 'Pesquisa', state: research.quality, summary: research.totalResearches
        ? `${research.opportunities} oportunidade(s), freshness ${research.freshness}.`
        : 'Nenhuma pesquisa persistida ainda.' },
      { area: 'Planejamento', state: planning.status === 'MISSING' ? 'MISSING'
        : planning.blocked > 0 || planning.conflicts > 0 ? 'PARTIAL' : 'GOOD',
      summary: planning.planId
        ? `${planning.ready} prontos, ${planning.needsResearch} aguardando pesquisa e ${planning.blocked} bloqueados.`
        : 'Nenhum plano estrategico ativo.' },
      { area: 'Experimentos', state: experimentation.stale > 0 || experimentation.lowConfidence > 0 ? 'PARTIAL'
        : experimentation.total > 0 ? 'GOOD' : 'MISSING', summary: experimentation.total
        ? `${experimentation.active} ativos, ${experimentation.waitingForData} aguardando dados e ${experimentation.inconclusive} inconclusivos.`
        : 'Nenhum experimento estrategico registrado.' },
      { area: 'Monitoramento', state: strategicMonitoring.critical > 0 ? 'ERROR'
        : strategicMonitoring.high > 0 ? 'PARTIAL' : strategicMonitoring.total > 0 ? 'GOOD' : 'MISSING',
      summary: strategicMonitoring.active
        ? `${strategicMonitoring.active} sinal(is) ativo(s), ${strategicMonitoring.high} HIGH e ${strategicMonitoring.critical} CRITICAL.`
        : 'Nenhum sinal estrategico ativo.' },
      { area: 'Packaging', state: packaging.needingReview > 0 ? 'PARTIAL' : packaging.total > 0 ? 'GOOD' : 'MISSING',
        summary: packaging.total ? `${packaging.total} embalagem(ns), ${packaging.selected} selecionada(s) e ${packaging.published} publicada(s).` : 'Nenhuma embalagem persistida.' },
      { area: 'Producao', state: productions.some((item) => item.steps.some(({ state }) => ['FAILED', 'BLOCKED'].includes(state))) ? 'PARTIAL' : productions.length ? 'GOOD' : 'MISSING',
        summary: productions.length ? `${productions.length} producao(oes), ${productions.filter(({ status }) => status === 'READY_TO_PUBLISH').length} pronta(s) para publicar.` : 'Nenhuma producao persistida.' },
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
      research,
      planning,
      experimentation,
      strategicMonitoring,
      channelContext,
      packaging,
      production: { total: productions.length, ready: productions.filter(({ status }) => status === 'READY_TO_PUBLISH').length, blocked: productions.filter((item) => item.steps.some(({ state }) => ['FAILED', 'BLOCKED'].includes(state))).length,
        chapters: { selected: productions.filter((item) => item.chapterSets.some(({ status }) => status === 'SELECTED')).length, stale: productions.filter((item) => item.chapterSets.some(({ status }) => status === 'STALE')).length } },
      audience,
    };
  }
}
