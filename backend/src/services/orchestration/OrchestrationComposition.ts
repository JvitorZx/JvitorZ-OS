import type { CapabilityOutput, OrchestrationStepResult } from '../../domains/orchestration';
import { SupervisorModule } from '../../modules/dashboard/supervisor/SupervisorModule';
import { LibraryService } from '../LibraryService';
import { CreatorIntelligenceService } from '../creator-intelligence/CreatorIntelligenceService';
import {
  EditorialDecisionService,
  parseEditorialDecisionArrays,
} from '../creator-intelligence/EditorialDecisionService';
import { DecisionOutcomeService } from '../creator-intelligence/DecisionOutcomeService';
import { OutcomeRefreshService } from '../creator-intelligence/OutcomeRefreshService';
import { YouTubePerformanceSyncService } from '../performance-intelligence/YouTubePerformanceSyncService';
import { CapabilityRegistry } from './CapabilityRegistry';
import { composeOrchestrationResponse, consolidateEvidence } from './EvidenceConsolidator';
import { ChannelOperatorService } from '../channel-operators';
import type { ChannelOperatorId } from '../../domains/channel-operators';

export interface OrchestrationDependencies {
  intelligence: Pick<CreatorIntelligenceService,
    'listPerformanceRecords' | 'listPerformanceSignals' | 'getPerformanceBaseline'>;
  editorial: Pick<EditorialDecisionService, 'generate'>;
  outcomes: Pick<DecisionOutcomeService, 'listOutcomes'>;
  refresh: Pick<OutcomeRefreshService, 'listStates' | 'refreshAvailable'>;
  supervisor: Pick<SupervisorModule, 'getSupervisorOverview'>;
  library: Pick<LibraryService, 'listItems'>;
  youtube: Pick<YouTubePerformanceSyncService, 'sync'>;
  channelOperators: Pick<ChannelOperatorService, 'run'>;
}

const previousOutputs = (results: ReadonlyMap<string, OrchestrationStepResult>): CapabilityOutput[] =>
  [...results.values()].flatMap(({ output }) => output ? [output] : []);

export const createDefaultOrchestrationDependencies = (): OrchestrationDependencies => {
  const intelligence = new CreatorIntelligenceService();
  const editorial = new EditorialDecisionService(intelligence);
  const refresh = new OutcomeRefreshService();
  return {
    intelligence,
    editorial,
    outcomes: new DecisionOutcomeService(),
    refresh,
    supervisor: new SupervisorModule(undefined, editorial, refresh),
    library: new LibraryService(),
    youtube: new YouTubePerformanceSyncService(),
    channelOperators: new ChannelOperatorService(),
  };
};

export const createDefaultCapabilityRegistry = (
  dependencies: OrchestrationDependencies = createDefaultOrchestrationDependencies(),
): CapabilityRegistry => {
  const registry = new CapabilityRegistry();

  registry.register({
    id: 'performance.read', responsibility: 'Ler snapshots, baseline e sinais persistidos.',
    inputs: ['projectId'], outputs: ['facts', 'baseline', 'signals'], availability: 'available',
    dependencies: [], access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false,
  }, async ({ request }) => {
    const [records, baseline, signals] = await Promise.all([
      dependencies.intelligence.listPerformanceRecords(request.projectId),
      dependencies.intelligence.getPerformanceBaseline(request.projectId),
      dependencies.intelligence.listPerformanceSignals(request.projectId),
    ]);
    return {
      summary: `${records.length} snapshots e ${signals.length} sinais disponíveis.`,
      facts: [`${records.length} snapshots de performance persistidos.`, `${signals.length} sinais internos disponíveis.`],
      missingData: records.length === 0 ? ['performance snapshots'] : [],
      confidence: records.length === 0 ? 0 : 1,
      data: { snapshotCount: records.length, signalCount: signals.length, baseline },
    };
  });

  registry.register({
    id: 'analytics.read', responsibility: 'Interpretar o estado agregado de performance já carregado.',
    inputs: ['performance.read'], outputs: ['analytics summary'], availability: 'available',
    dependencies: ['performance.read'], access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false,
  }, async ({ results }) => {
    const performance = results.get('performance')?.output;
    const count = Number(performance?.data?.snapshotCount ?? 0);
    return {
      summary: count > 0 ? 'Analytics possui dados persistidos para análise.' : 'Analytics ainda não possui snapshots.',
      facts: [count > 0 ? `Analytics consolidou ${count} snapshots.` : 'Analytics não possui snapshots persistidos.'],
      missingData: count > 0 ? [] : ['YouTube performance'],
      confidence: count > 0 ? 1 : 0,
      data: { snapshotCount: count },
    };
  });

  const specialized = [
    ['ctr', 'Analisar CTR real e sua distância da mediana observada.'],
    ['retention', 'Analisar retenção média, duração e watch time reais.'],
    ['long-form', 'Analisar snapshots explicitamente classificados como long-form.'],
    ['shorts', 'Analisar snapshots explicitamente classificados como Shorts.'],
  ] as const;
  for (const [operatorId, responsibility] of specialized) {
    registry.register({
      id: `channel-operator.${operatorId}`, responsibility,
      inputs: ['projectId'], outputs: ['facts', 'signals', 'recommendations', 'missingData'], availability: 'available',
      dependencies: [], access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false,
    }, async ({ request }) => {
      const analysis = await dependencies.channelOperators.run(operatorId as ChannelOperatorId, request.projectId);
      return {
        summary: `${analysis.name}: ${analysis.status} com ${analysis.sampleSize} evidências.`,
        facts: analysis.facts.map((fact) => `${fact.label}: ${fact.value ?? 'indisponível'}.`),
        inferences: [...analysis.insights, ...analysis.signals.filter(({ classification }) => classification === 'inference').map(({ summary }) => summary)],
        recommendations: analysis.recommendations,
        missingData: analysis.missingData,
        confidence: analysis.confidence,
        data: { operatorId: analysis.id, status: analysis.status, sampleSize: analysis.sampleSize },
      };
    });
  }

  registry.register({
    id: 'creator-intelligence.decide', responsibility: 'Gerar decisão editorial explicável.',
    inputs: ['intent', 'projectId', 'conversationId'], outputs: ['decision', 'evidence'], availability: 'available',
    dependencies: ['performance.read'], access: 'write', sideEffect: 'INTERNAL_WRITE', persistentMutation: true,
    maxAffectedItems: 1,
  }, async ({ request }) => {
    const { decision } = await dependencies.editorial.generate({
      question: request.intent,
      projectId: request.projectId,
      conversationId: request.conversationId,
    });
    const parsed = parseEditorialDecisionArrays(decision);
    return {
      summary: decision.recommendation,
      facts: parsed.evidence.filter(({ classification }) => classification === 'fact').map(({ summary }) => summary),
      inferences: parsed.evidence.filter(({ classification }) => classification === 'inference').map(({ summary }) => summary),
      recommendations: [decision.recommendation, decision.nextAction],
      risks: parsed.risks,
      missingData: parsed.missingData,
      confidence: decision.confidence,
      data: { decisionId: decision.id, intent: decision.intent },
    };
  });

  registry.register({
    id: 'decision-outcomes.read', responsibility: 'Consultar outcomes editoriais persistidos.',
    inputs: ['projectId', 'conversationId'], outputs: ['outcomes'], availability: 'available',
    dependencies: [], access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false,
  }, async ({ request }) => {
    const outcomes = await dependencies.outcomes.listOutcomes({
      projectId: request.projectId,
      conversationId: request.conversationId,
      limit: 20,
    });
    const latest = outcomes[0];
    return {
      summary: `${outcomes.length} outcomes editoriais encontrados.`,
      facts: latest ? [`Outcome mais recente: ${latest.classification}.`] : [],
      inferences: latest ? ['O outcome representa associação observada, não causalidade.'] : [],
      missingData: outcomes.length === 0 ? ['evaluated decision outcomes'] : [],
      confidence: latest?.confidence ?? 0,
      data: { count: outcomes.length, latestOutcomeId: latest?.id ?? null },
    };
  });

  registry.register({
    id: 'outcome-refresh.inspect', responsibility: 'Detectar outcomes com evidência nova.',
    inputs: [], outputs: ['review states'], availability: 'available',
    dependencies: [], access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false,
  }, async () => {
    const states = await dependencies.refresh.listStates();
    const reviewAvailable = states.filter(({ state }) => state === 'review_available').length;
    const insufficient = states.filter(({ state }) => state === 'insufficient_data').length;
    return {
      summary: `${reviewAvailable} outcomes aguardam revisão.`,
      facts: [`${reviewAvailable} outcomes com revisão disponível.`, `${insufficient} outcomes inconclusivos.`],
      missingData: insufficient > 0 ? ['sufficient outcome evidence'] : [],
      confidence: 1,
      data: { reviewAvailable, insufficient, total: states.length },
    };
  });

  registry.register({
    id: 'outcome-refresh.run', responsibility: 'Revisar outcomes elegíveis de forma explícita.',
    inputs: ['outcome-refresh.inspect'], outputs: ['review summary'], availability: 'available',
    dependencies: ['outcome-refresh.inspect'], access: 'write', sideEffect: 'INTERNAL_WRITE', persistentMutation: true,
    maxAffectedItems: 20,
  }, async ({ results }) => {
    const available = Number(results.get('review-state')?.output?.data?.reviewAvailable ?? 0);
    if (available === 0) return { summary: 'Nenhum outcome precisa de revisão.', skipped: true, confidence: 1 };
    const summary = await dependencies.refresh.refreshAvailable();
    return {
      summary: `${summary.reviewed} revisados, ${summary.unchanged} sem mudança e ${summary.failed} falhas.`,
      facts: [`${summary.reviewed + summary.unchanged} outcomes processados.`],
      risks: summary.failed > 0 ? [`${summary.failed} revisões falharam.`] : [],
      confidence: summary.failed > 0 ? 0.5 : 1,
      data: { reviewed: summary.reviewed, unchanged: summary.unchanged, failed: summary.failed },
    };
  });

  registry.register({
    id: 'supervisor.read', responsibility: 'Consolidar o estado operacional do sistema.',
    inputs: [], outputs: ['operational status'], availability: 'available',
    dependencies: [], access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false,
  }, async () => {
    const overview = await dependencies.supervisor.getSupervisorOverview();
    return {
      summary: 'Estado operacional consolidado pelo Supervisor.',
      facts: [
        `YouTube Analytics: ${overview.youtubeAnalytics.state}.`,
        `${overview.outcomeReviews.reviewAvailable} outcomes com revisão disponível.`,
      ],
      risks: overview.editorial.risks,
      recommendations: overview.editorial.actions,
      confidence: 1,
      data: { youtubeAnalytics: overview.youtubeAnalytics.state, outcomeReviews: overview.outcomeReviews },
    };
  });

  registry.register({
    id: 'library.read', responsibility: 'Consultar artefatos persistidos da Biblioteca.',
    inputs: [], outputs: ['library item summaries'], availability: 'available',
    dependencies: [], access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false,
  }, async () => {
    const items = await dependencies.library.listItems();
    return {
      summary: `${items.length} artefatos disponíveis na Biblioteca.`,
      facts: [`${items.length} artefatos persistidos.`], confidence: 1,
      data: { count: items.length, itemIds: items.slice(0, 10).map(({ id }) => id) },
    };
  });

  registry.register({
    id: 'youtube.sync', responsibility: 'Sincronizar manualmente métricas reais do YouTube.',
    inputs: ['sync parameters', 'explicit confirmation'], outputs: ['ingestion summary'], availability: 'available',
    dependencies: [], access: 'external_side_effect', sideEffect: 'EXTERNAL_READ', persistentMutation: true,
    maxAffectedItems: 20,
  }, async ({ request }) => {
    if (!request.sync) throw new Error('Sync parameters are required');
    const result = await dependencies.youtube.sync({ ...request.sync, projectId: request.projectId });
    return {
      summary: `${result.created} snapshots criados e ${result.updated} atualizados.`,
      facts: [`${result.created + result.updated} registros de performance processados.`],
      confidence: 1,
      data: { created: result.created, updated: result.updated },
    };
  });

  registry.register({
    id: 'planner.respond', responsibility: 'Transformar contexto consolidado em resposta editorial legível.',
    inputs: ['capability outputs'], outputs: ['consolidated response'], availability: 'available',
    dependencies: [], access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false,
  }, async ({ results }) => {
    const synthetic = previousOutputs(results).map((output, index): OrchestrationStepResult => ({
      stepId: `input-${index}`, capabilityId: 'input', status: 'completed', durationMs: 0, output,
    }));
    const evidence = consolidateEvidence(synthetic);
    return {
      summary: composeOrchestrationResponse(evidence),
      recommendations: evidence.recommendations,
      facts: evidence.facts,
      inferences: evidence.inferences,
      risks: evidence.risks,
      missingData: evidence.missingData,
      confidence: evidence.confidence,
    };
  });

  return registry;
};
