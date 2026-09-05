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
import {
  YouTubePerformanceSyncService,
  youtubePerformanceSyncService,
} from '../performance-intelligence/YouTubePerformanceSyncService';
import { CapabilityRegistry } from './CapabilityRegistry';
import { composeOrchestrationResponse, consolidateEvidence } from './EvidenceConsolidator';
import { ChannelOperatorService } from '../channel-operators';
import type { ChannelOperatorId } from '../../domains/channel-operators';
import { AudienceIntelligenceService } from '../audience/AudienceIntelligenceService';
import { ResearchIdeationService, ResearchService } from '../research';
import type { ResearchExecution, ResearchOpportunity } from '../../domains/research';
import { StrategicPlanningService } from '../strategic-planning';
import { ExperimentationService } from '../strategic-experimentation';
import { StrategicMonitoringService } from '../strategic-monitoring';
import { ChannelContextResolver } from '../channel-context';
import { PackagingService } from '../packaging';
import { ProductionService } from '../production';
import { ChaptersService, ChaptersConflictError, ChaptersNotFoundError } from '../chapters';

export interface OrchestrationDependencies {
  intelligence: Pick<CreatorIntelligenceService,
    'listPerformanceRecords' | 'listPerformanceSignals' | 'getPerformanceBaseline'>;
  editorial: Pick<EditorialDecisionService, 'generate' | 'compareCandidates' | 'list'>;
  outcomes: Pick<DecisionOutcomeService, 'listOutcomes'>;
  refresh: Pick<OutcomeRefreshService, 'listStates' | 'refreshAvailable'>;
  supervisor: Pick<SupervisorModule, 'getSupervisorOverview'>;
  library: Pick<LibraryService, 'listItems'>;
  youtube: Pick<YouTubePerformanceSyncService, 'sync'>;
  channelOperators: Pick<ChannelOperatorService, 'run'>;
  audience: Pick<AudienceIntelligenceService, 'summary' | 'traffic'>;
  research: Pick<ResearchService, 'research'>;
  researchStudio?: Pick<ResearchIdeationService, 'createSession' | 'runSession' | 'generateIdeas'>;
  planning: Pick<StrategicPlanningService, 'getOrGenerateCurrent'>;
  experimentation: Pick<ExperimentationService, 'list'>;
  monitoring: Pick<StrategicMonitoringService, 'list'>;
  channelContext: Pick<ChannelContextResolver, 'resolve'>;
  packaging: Pick<PackagingService, 'list'>;
  production: Pick<ProductionService, 'create' | 'list' | 'resume' | 'startStep' | 'skipStep' | 'retryStep' | 'repeatStep'>;
  chapters: Pick<ChaptersService, 'generate' | 'listVersions'>;
}

const previousOutputs = (results: ReadonlyMap<string, OrchestrationStepResult>): CapabilityOutput[] =>
  [...results.values()].flatMap(({ output }) => output ? [output] : []);

const outputFor = (results: ReadonlyMap<string, OrchestrationStepResult>, capabilityId: string) =>
  [...results.values()].find((result) => result.capabilityId === capabilityId)?.output;

export const createDefaultOrchestrationDependencies = (): OrchestrationDependencies => {
  const intelligence = new CreatorIntelligenceService();
  const editorial = new EditorialDecisionService(intelligence);
  const refresh = new OutcomeRefreshService();
  const research = new ResearchService();
  return {
    intelligence,
    editorial,
    outcomes: new DecisionOutcomeService(),
    refresh,
    supervisor: new SupervisorModule(undefined, editorial, refresh),
    library: new LibraryService(),
    youtube: youtubePerformanceSyncService,
    channelOperators: new ChannelOperatorService(),
    audience: new AudienceIntelligenceService(),
    research,
    researchStudio: new ResearchIdeationService(research),
    planning: new StrategicPlanningService(),
    experimentation: new ExperimentationService(),
    monitoring: new StrategicMonitoringService(),
    channelContext: new ChannelContextResolver(),
    packaging: new PackagingService(),
    production: new ProductionService(),
    chapters: new ChaptersService(),
  };
};

export const createDefaultCapabilityRegistry = (
  dependencies: OrchestrationDependencies = createDefaultOrchestrationDependencies(),
): CapabilityRegistry => {
  const registry = new CapabilityRegistry();

  registry.register({
    id: 'production.manage', responsibility: 'Consultar e avancar o pipeline persistente, incluindo Chapters quando houver transcript temporal, sem publicar externamente.',
    inputs: ['intent', 'projectId'], outputs: ['production state', 'next action', 'blockers'], availability: 'available', dependencies: [],
    access: 'write', sideEffect: 'INTERNAL_WRITE', persistentMutation: true, maxAffectedItems: 1, capabilityTags: ['production'],
  }, async ({ request }) => {
    const normalized = request.intent.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    let production = (await dependencies.production.list({ projectId: request.projectId, limit: 1 }))[0] ?? null;
    if (!production && /(comec|inici|cria)/.test(normalized)) {
      const inferredTitle = request.intent.replace(/^(comec|comece|inici|inicie|cria|crie)\S*\s+(a\s+)?producao\s+(do|da|de)?\s*/i, '').replace(/[.!?]+$/g, '').trim();
      const created = await dependencies.production.create({ title: inferredTitle || 'Nova producao', projectId: request.projectId, format: /short/.test(normalized) ? 'SHORT' : 'LONG_FORM', origin: 'MANAGER' });
      production = created.production;
    }
    if (!production) return { summary: 'Nenhuma producao persistida.', facts: [], recommendations: ['Crie uma producao informando titulo e formato.'], missingData: ['production'], confidence: 1, data: {} };
    if (/capitulo/.test(normalized) && /(faz|gera|regenera|revisa|mostra|lista)/.test(normalized) && dependencies.chapters) {
      try {
        if (/(mostra|lista|revisa)/.test(normalized)) {
          const versions = await dependencies.chapters.listVersions(production.id);
          const selected = versions.find(({ status }) => status === 'SELECTED') ?? versions[0];
          return { summary: selected ? `${selected.entries.length} capitulo(s) na versao ${selected.version} (${selected.status}).` : 'Nenhuma versao de capitulos gerada.', facts: selected?.entries.map(({ startMs, title }) => `${startMs}ms: ${title}`) ?? [], recommendations: selected?.status === 'STALE' ? ['Regenerar e revisar os capitulos com o transcript atual.'] : [], missingData: selected ? [] : ['timed transcript ou geracao de capitulos'], confidence: selected ? 1 : 0, data: selected ? { productionId: production.id, chapterSetId: selected.id } : { productionId: production.id } };
        }
        const result = await dependencies.chapters.generate(production.id, { regenerate: /regenera/.test(normalized) });
        return { summary: `${result.chapterSet.entries.length} capitulo(s) gerados para revisao na versao ${result.chapterSet.version}.`, facts: result.chapterSet.entries.map(({ startMs, title }) => `${startMs}ms: ${title}`), recommendations: ['Revise e selecione explicitamente a versao final.'], missingData: [], confidence: 1, data: { productionId: production.id, chapterSetId: result.chapterSet.id } };
      } catch (error) {
        if (error instanceof ChaptersConflictError || error instanceof ChaptersNotFoundError) return { summary: 'Chapters nao pode ser executado sem uma fonte temporal valida.', facts: [], recommendations: ['Importe um transcript SBV, SRT ou VTT para esta producao.'], missingData: ['timed transcript'], confidence: 1, data: { productionId: production.id } };
        throw error;
      }
    }
    if (/pul(a|e|ar).*capitulo/.test(normalized)) production = await dependencies.production.skipStep(production.id, 'CHAPTERS', { reason: 'Etapa pulada por decisao explicita via Gerente', origin: 'manager' });
    else if (/(continua|continue|proxima etapa|proximo passo|avanca|avance)/.test(normalized)) {
      const next = production.nextAction;
      if (next.stepKey && next.type === 'START') production = await dependencies.production.startStep(production.id, next.stepKey, { origin: 'manager' });
      else if (next.stepKey && next.type === 'RETRY') production = await dependencies.production.retryStep(production.id, next.stepKey, { origin: 'manager' });
      else if (next.stepKey && next.type === 'REVIEW_STALE') production = await dependencies.production.repeatStep(production.id, next.stepKey, { reason: 'Revisao explicita via Gerente', origin: 'manager' });
    }
    const blockers = production.steps.filter(({ state }) => ['BLOCKED', 'FAILED', 'OUTDATED'].includes(state)).map(({ label, state }) => `${label}: ${state}`);
    return { summary: `${production.title}: ${production.status}, etapa ${production.currentStage}.`, facts: [`Workflow ${production.workflowTemplate} com ${production.steps.length} etapas.`], recommendations: [production.nextAction.label], risks: blockers, missingData: [], confidence: 1, data: { productionId: production.id, status: production.status, currentStage: production.currentStage, nextAction: production.nextAction } };
  });

  registry.register({
    id: 'packaging.read', responsibility: 'Consultar variantes persistidas e seu contexto sem prever performance ou alterar a escolha do criador.',
    inputs: ['intent', 'projectId'], outputs: ['packaging variants', 'rationale', 'missing data'], availability: 'available',
    dependencies: [], access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false, capabilityTags: ['packaging'],
  }, async ({ request }) => {
    const rows = await dependencies.packaging.list({ projectId: request.projectId, limit: 5 });
    const latest = rows[0];
    return {
      summary: latest ? `${latest.variants.length} variante(s) de embalagem disponiveis para ${latest.game ?? latest.series ?? 'o conteudo mais recente'}.` : 'Nenhuma embalagem persistida; informe o acontecimento real no workspace Packaging antes de gerar opcoes.',
      facts: latest?.variants.slice(0, 5).map(({ key, title, status }) => `${key}: ${title} (${status}).`) ?? [],
      recommendations: latest?.variants.filter(({ status }) => status !== 'REJECTED').slice(0, 3).map(({ title, rationale }) => `${title}: ${rationale}`) ?? [],
      missingData: latest ? [] : ['acontecimento principal e resumo do conteudo'], confidence: latest ? 0.85 : 0,
      data: latest ? { packagingId: latest.id, variantIds: latest.variants.map(({ id }) => id) } : {},
    };
  });

  registry.register({
    id: 'channel-context.read', responsibility: 'Selecionar memoria temporal relevante do canal sem despejar todo o historico.',
    inputs: ['intent', 'projectId'], outputs: ['typed creator context', 'provenance'], availability: 'available',
    dependencies: [], access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false, capabilityTags: ['creator-context'],
  }, async ({ request }) => {
    const resolved = await dependencies.channelContext.resolve({ projectId: request.projectId, text: request.intent, limit: 8, maxCharacters: 4_000 });
    const facts = resolved.entries.filter(({ type }) => type === 'FACT').map(({ subject, statement }) => `${subject}: ${statement}`);
    const inferences = resolved.entries.filter(({ type }) => ['HYPOTHESIS', 'LEARNING', 'PLATFORM_CHANGE'].includes(type))
      .map(({ type, subject, statement }) => `[${type}] ${subject}: ${statement}`);
    const recommendations = resolved.entries.filter(({ type }) => type === 'DECISION').map(({ subject, statement }) => `${subject}: ${statement}`);
    return {
      summary: resolved.entries.length ? `${resolved.entries.length} registros temporais relevantes selecionados.` : 'Nenhum contexto temporal relevante disponivel.',
      facts, inferences, recommendations, confidence: resolved.entries.length
        ? Math.min(...resolved.entries.map(({ confidence }) => confidence)) : 0,
      data: { contextIds: resolved.entries.map(({ id }) => id), types: resolved.entries.map(({ type }) => type), truncated: resolved.truncated },
    };
  });

  registry.register({
    id: 'strategic-monitoring.read', responsibility: 'Consultar sinais estrategicos ativos, evidencias e limitacoes sem executar acoes externas.',
    inputs: ['projectId'], outputs: ['active strategic signals', 'evidence', 'limitations'], availability: 'available',
    dependencies: [], access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false, capabilityTags: ['monitoring'],
  }, async ({ request }) => {
    const rows = await dependencies.monitoring.list({ projectId: request.projectId, limit: 100 });
    const active = rows.filter(({ state }) => ['NEW', 'ACKNOWLEDGED'].includes(state));
    const important = active.filter(({ severity }) => ['HIGH', 'CRITICAL'].includes(severity));
    return {
      summary: active.length ? `${active.length} sinal(is) estrategico(s) ativo(s).` : 'Nenhum sinal estrategico ativo.',
      facts: active.slice(0, 6).map(({ severity, type, subject, summary }) => `[${severity}/${type}] ${subject}: ${summary}`),
      risks: important.map(({ subject, summary }) => `${subject}: ${summary}`).slice(0, 6),
      missingData: active.filter(({ type }) => ['DATA_MISSING', 'DATA_STALE', 'DATA_QUALITY_DEGRADED'].includes(type))
        .map(({ subject }) => subject).slice(0, 6),
      confidence: active.length ? Math.min(...active.map(({ confidence }) => confidence)) : 1,
      data: { active: active.map(({ id, type, severity, subject, state }) => ({ id, type, severity, subject, state })) },
    };
  });

  registry.register({
    id: 'strategic-experimentation.read', responsibility: 'Consultar hipoteses, variantes e resultados observados sem afirmar causalidade.',
    inputs: ['projectId'], outputs: ['active experiments', 'observed results', 'limitations'], availability: 'available',
    dependencies: [], access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false, capabilityTags: ['experimentation'],
  }, async ({ request }) => {
    const experiments = await dependencies.experimentation.list({ projectId: request.projectId, limit: 20 });
    const active = experiments.filter(({ status }) => ['READY', 'RUNNING', 'WAITING_FOR_DATA'].includes(status));
    const latest = experiments.find(({ result }) => Boolean(result));
    return {
      summary: active.length ? `${active.length} experimento(s) estrategico(s) ativo(s).` : 'Nenhum experimento estrategico ativo.',
      facts: experiments.slice(0, 5).map(({ title, status, result }) => `${title}: ${status}${result ? `, resultado ${result.classification}` : ''}.`),
      inferences: latest?.result ? [latest.result.summary] : [],
      risks: experiments.filter(({ result }) => result && result.confidence < 0.5).map(({ title }) => `${title}: baixa confianca observacional.`),
      missingData: active.filter(({ status }) => status === 'WAITING_FOR_DATA').map(({ title }) => `${title}: observacoes comparaveis.`),
      confidence: latest?.result?.confidence ?? 0,
      data: { active: active.map(({ id, title, status }) => ({ id, title, status })), latestResult: latest?.result ?? null },
    };
  });

  registry.register({
    id: 'strategic-planning.current', responsibility: 'Consultar ou gerar a fila editorial atual sem prever views.',
    inputs: ['projectId'], outputs: ['content plan', 'execution queue', 'risks', 'missingData'], availability: 'available',
    dependencies: [], access: 'write', sideEffect: 'INTERNAL_WRITE', persistentMutation: true,
    maxAffectedItems: 12, capabilityTags: ['planning'],
  }, async ({ request }) => {
    const { plan, generated } = await dependencies.planning.getOrGenerateCurrent({
      projectId: request.projectId,
      horizon: 'TODAY',
    });
    const next = plan.items.filter(({ executionState, queue }) => executionState === 'in_progress' || queue === 'NEXT')
      .sort((a, b) => (a.executionState === 'in_progress' ? -1 : 0) - (b.executionState === 'in_progress' ? -1 : 0));
    const waiting = plan.items.filter(({ queue }) => ['WAITING', 'BLOCKED'].includes(queue));
    const evidenceCounts = plan.items.map(({ evidence }) => Array.isArray(evidence) ? evidence.length : 0);
    return {
      summary: next[0]
        ? `Proxima prioridade editorial: ${next[0].title}.`
        : `Plano ${plan.status} sem item pronto para execucao.`,
      facts: [`Plano ${plan.id} (${plan.horizon}) com ${plan.items.length} item(ns).`],
      inferences: next.map(({ rationale }) => rationale).slice(0, 2),
      recommendations: [
        ...next.map(({ executionAction }) => executionAction),
        ...plan.items.filter(({ queue }) => queue === 'LATER').slice(0, 2).map(({ title }) => `Depois: ${title}.`),
      ],
      risks: waiting.map(({ title, readiness }) => `${title}: ${readiness}.`).slice(0, 6),
      missingData: waiting.filter(({ readiness }) => readiness === 'NEEDS_RESEARCH').map(({ title }) => `Pesquisa para ${title}`).slice(0, 6),
      confidence: evidenceCounts.length ? Math.min(1, evidenceCounts.reduce((sum, count) => sum + count, 0) / Math.max(1, plan.items.length * 3)) : 0,
      data: {
        planId: plan.id, generated, status: plan.status, horizon: plan.horizon,
        items: plan.items.map(({ id, title, priority, readiness, queue, position, executionScore, executionState, executionAction, executionConfidence }) => ({
          id, title, priority, readiness, queue, position, executionScore, executionState, executionAction, executionConfidence,
        })),
      },
    };
  });

  registry.register({
    id: 'performance.read', responsibility: 'Ler snapshots, baseline e sinais persistidos.',
    inputs: ['projectId'], outputs: ['facts', 'baseline', 'signals'], availability: 'available',
    dependencies: [], access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false,
    capabilityTags: ['performance'],
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
    capabilityTags: ['analytics'],
  }, async ({ results }) => {
    const performance = outputFor(results, 'performance.read');
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
    ['trends', 'Detectar mudanças significativas em janelas equivalentes.'],
    ['series', 'Avaliar saúde e evolução de séries com evidência suficiente.'],
  ] as const;
  for (const [operatorId, responsibility] of specialized) {
    registry.register({
      id: `channel-operator.${operatorId}`, responsibility,
      inputs: ['projectId'], outputs: ['facts', 'signals', 'recommendations', 'missingData'], availability: 'available',
      dependencies: [], access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false,
      capabilityTags: [operatorId],
    }, async ({ request }) => {
      const analysis = await dependencies.channelOperators.run(operatorId as ChannelOperatorId, request.projectId);
      return {
        summary: `${analysis.name}: ${analysis.status} com ${analysis.sampleSize} evidências.`,
        facts: analysis.facts.map((fact) => `${fact.label}: ${fact.value ?? 'indisponível'}.`),
        inferences: [...analysis.insights, ...analysis.signals.filter(({ classification }) => classification === 'inference').map(({ summary }) => summary)],
        recommendations: analysis.recommendations,
        missingData: analysis.missingData,
        confidence: analysis.confidence,
        data: {
          operatorId: analysis.id,
          status: analysis.status,
          sampleSize: analysis.sampleSize,
          lastDataAt: analysis.lastDataAt,
          quality: analysis.quality ?? null,
          signalDirections: analysis.signals.map(({ direction }) => direction),
        },
      };
    });
  }

  registry.register({
    id: 'audience.read', responsibility: 'Analisar audiencia e segmentos persistidos.',
    inputs: ['projectId'], outputs: ['facts', 'audience signals', 'missingData'], availability: 'available',
    dependencies: [], access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false,
    capabilityTags: ['audience'],
  }, async ({ request }) => {
    const summary = await dependencies.audience.summary(request.projectId);
    return {
      summary: `${summary.facts.length} fatos de audiencia disponiveis.`,
      facts: summary.facts,
      inferences: summary.signals,
      recommendations: summary.recommendations,
      missingData: summary.missingData,
      confidence: summary.confidence,
      data: {
        sampleSize: summary.trafficSources.length + summary.countries.length + summary.devices.length,
        quality: summary.quality,
      },
    };
  });

  registry.register({
    id: 'traffic-sources.read', responsibility: 'Analisar fontes de trafego persistidas e sua qualidade.',
    inputs: ['projectId'], outputs: ['traffic sources', 'signals', 'missingData'], availability: 'available',
    dependencies: [], access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false,
    capabilityTags: ['traffic-sources'],
  }, async ({ request }) => {
    const traffic = await dependencies.audience.traffic(request.projectId);
    const top = traffic.sources[0];
    return {
      summary: top ? `Principal fonte de trafego: ${top.segment}.` : 'Fontes de trafego indisponiveis.',
      facts: top ? [`${top.segment} representa ${Math.round(top.viewShare * 100)}% das views observadas.`] : [],
      inferences: traffic.signals,
      missingData: traffic.missingData,
      confidence: traffic.sources.length ? Math.min(1, traffic.sources.length / 5) : 0,
      data: { sampleSize: traffic.sources.length, quality: traffic.quality },
    };
  });

  registry.register({
    id: 'research.discover', responsibility: 'Descobrir candidatos e evidências sem tomar a decisão editorial final.',
    inputs: ['intent', 'projectId'], outputs: ['research candidates', 'evidence', 'freshness'], availability: 'available',
    dependencies: [], access: 'write', sideEffect: 'INTERNAL_WRITE', persistentMutation: true,
    maxAffectedItems: 20, capabilityTags: ['research'],
  }, async ({ request }) => {
    const normalized = request.intent.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const wantsIdeas = /(ideia|gravar agora|barat.|experimento)/.test(normalized);
    const wantsGames = /(jogo|game)/.test(normalized);
    let execution: ResearchExecution;
    let studio: { sessionId: string; ideas: Array<{ id: string; premise: string; status: string; score: number | null; duplicateWarning: string | null }> } | null = null;
    if (dependencies.researchStudio) {
      const session = await dependencies.researchStudio.createSession({
        query: request.intent, projectId: request.projectId, objective: request.intent,
        subjectType: wantsGames ? 'GAME' : wantsIdeas ? 'IDEA' : undefined,
        format: /short/.test(normalized) ? 'SHORT' : /long/.test(normalized) ? 'LONG_FORM' : undefined,
      });
      const completed = await dependencies.researchStudio.runSession(session.id);
      execution = {
        historyId: completed.id,
        query: {
          text: completed.query,
          normalized: completed.normalizedQuery,
          intent: completed.intent as ResearchExecution['query']['intent'],
          projectId: completed.projectId,
          subjectType: completed.subjectType as ResearchExecution['query']['subjectType'],
          subject: completed.subject,
        },
        sources: completed.sources as unknown as ResearchExecution['sources'],
        results: completed.results as unknown as ResearchExecution['results'],
        opportunities: completed.opportunities.map((item): ResearchOpportunity => ({
          key: item.key,
          rank: item.rank,
          subject: item.subject,
          subjectType: item.subjectType as ResearchOpportunity['subjectType'],
          state: item.state as ResearchOpportunity['state'],
          summary: item.summary,
          sources: item.sources as unknown as string[],
          evidence: item.evidence as unknown as ResearchOpportunity['evidence'],
          freshness: item.freshness as ResearchOpportunity['freshness'],
          compatibility: item.compatibility,
          confidence: item.confidence,
          risks: item.risks as unknown as string[],
          gaps: item.gaps as unknown as string[],
          nextInvestigation: item.nextInvestigation,
        })),
        quality: completed.quality as ResearchExecution['quality'],
        freshness: completed.freshness as ResearchExecution['freshness'],
        limitations: completed.limitations as unknown as string[],
        researchedAt: completed.researchedAt.toISOString(),
        validUntil: completed.validUntil.toISOString(),
        cache: 'MISS',
      };
      if (wantsIdeas && completed.opportunities.length) {
        const generated = await dependencies.researchStudio.generateIdeas(completed.id, {
          objective: request.intent, format: completed.format ?? 'LONG_FORM', effort: /barat|baixo custo/.test(normalized) ? 'LOW' : 'UNKNOWN', limit: 5,
        });
        studio = { sessionId: completed.id, ideas: generated.ideas.map(({ idea, duplicateWarning }) => ({ id: idea.id, premise: idea.premise, status: idea.status, score: idea.opportunityScore, duplicateWarning })) };
      } else studio = { sessionId: completed.id, ideas: [] };
    } else execution = await dependencies.research.research({ query: request.intent, projectId: request.projectId });
    const opportunities = execution.opportunities.slice(0, 10);
    return {
      summary: `${opportunities.length} oportunidade(s) de pesquisa${studio?.ideas.length ? ` e ${studio.ideas.length} ideia(s)` : ''} encontradas com qualidade ${execution.quality}.`,
      facts: execution.results.flatMap(({ evidence }) => evidence.filter(({ classification }) => classification === 'fact').map(({ summary }) => summary)).slice(0, 6),
      inferences: opportunities.map(({ summary }) => summary).slice(0, 6),
      recommendations: opportunities.map(({ nextInvestigation }) => nextInvestigation).slice(0, 3),
      risks: [...new Set(opportunities.flatMap(({ risks }) => risks))].slice(0, 6),
      missingData: [...new Set([...execution.limitations, ...opportunities.flatMap(({ gaps }) => gaps)])].slice(0, 8),
      confidence: opportunities[0]?.confidence ?? 0,
      data: {
        historyId: execution.historyId, sessionId: studio?.sessionId ?? null, ideas: studio?.ideas ?? [], quality: execution.quality, freshness: execution.freshness,
        opportunities: opportunities.map(({ key, subject, subjectType, state, summary, sources, freshness, compatibility, confidence, evidence, risks, gaps, nextInvestigation }) => ({
          key, subject, subjectType, state, summary, sources, freshness, compatibility, confidence,
          evidence: evidence.slice(0, 8), risks, gaps, nextInvestigation,
        })),
      },
    };
  });

  registry.register({
    id: 'creator-intelligence.decide', responsibility: 'Gerar decisão editorial explicável.',
    inputs: ['intent', 'projectId', 'conversationId'], outputs: ['decision', 'evidence'], availability: 'available',
    dependencies: ['performance.read', 'research.discover'], access: 'write', sideEffect: 'INTERNAL_WRITE', persistentMutation: true,
    maxAffectedItems: 1, capabilityTags: ['editorial-decision'],
  }, async ({ request, results }) => {
    const candidates = request.context?.candidateLabels ?? [];
    const research = outputFor(results, 'research.discover')?.data?.opportunities;
    const researchOpportunities = Array.isArray(research) ? research : [];
    const { decision } = request.managerIntent === 'IDEA_COMPARISON' && candidates.length >= 2
      ? await dependencies.editorial.compareCandidates({
        question: request.intent,
        projectId: request.projectId,
        candidates: candidates.map((label) => ({ key: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label, type: 'GAME' as const })),
      })
      : await dependencies.editorial.generate({
        question: request.intent,
        projectId: request.projectId,
        conversationId: request.conversationId,
        researchOpportunities,
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
      data: {
        decisionId: decision.id,
        intent: decision.intent,
        category: decision.category,
        score: decision.score,
        confidence: decision.confidence,
        candidateType: decision.candidateType,
        candidateKey: decision.candidateKey,
      },
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
    id: 'editorial-decisions.read', responsibility: 'Consultar decisoes editoriais anteriores relevantes.',
    inputs: ['projectId', 'conversationId'], outputs: ['decision memory'], availability: 'available',
    dependencies: [], access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false,
    capabilityTags: ['decision-memory'],
  }, async ({ request }) => {
    const decisions = await dependencies.editorial.list({
      ...(request.conversationId ? { conversationId: request.conversationId } : { projectId: request.projectId }),
      limit: request.context?.relevantMemoryLimit ?? 5,
    });
    return {
      summary: `${decisions.length} decisoes editoriais anteriores relevantes.`,
      facts: decisions.slice(0, 3).map(({ category, recommendation }) => `Decisao ${category}: ${recommendation}`),
      missingData: decisions.length ? [] : ['previous editorial decisions'],
      confidence: decisions.length ? 1 : 0,
      data: { sampleSize: decisions.length, decisionIds: decisions.map(({ id }) => id) },
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
    capabilityTags: ['supervision', 'data-quality'],
  }, async () => {
    const overview = await dependencies.supervisor.getSupervisorOverview();
    return {
      summary: 'Estado operacional consolidado pelo Supervisor.',
      facts: [
        `YouTube Analytics: ${overview.youtubeAnalytics.state}.`,
        `YouTube Reach: ${overview.youtubeReach?.state ?? 'unavailable'} (${overview.youtubeReach?.quality?.state ?? 'MISSING'}).`,
        `${overview.outcomeReviews.reviewAvailable} outcomes com revisão disponível.`,
      ],
      risks: [...overview.editorial.risks, ...(overview.alerts ?? [])],
      recommendations: overview.editorial.actions,
      confidence: overview.youtubeReach?.quality?.state === 'GOOD' ? 1 : 0.7,
      data: {
        youtubeAnalytics: overview.youtubeAnalytics.state,
        youtubeReach: overview.youtubeReach?.state ?? 'unavailable',
        dataQuality: overview.dataQuality ?? [],
        outcomeReviews: overview.outcomeReviews,
        sampleSize: overview.channelOperators?.reduce((sum, item) => sum + item.sampleSize, 0) ?? 0,
        quality: {
          state: (overview.dataQuality ?? []).some(({ state }) => ['ERROR', 'MISSING'].includes(state)) ? 'PARTIAL' : 'GOOD',
          freshness: overview.youtubeReach?.quality?.freshness ?? 'MISSING',
        },
      },
    };
  });

  registry.register({
    id: 'library.read', responsibility: 'Consultar artefatos persistidos da Biblioteca.',
    inputs: [], outputs: ['library item summaries'], availability: 'available',
    dependencies: [], access: 'read', sideEffect: 'READ_ONLY', persistentMutation: false,
    capabilityTags: ['shared-memory'],
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
    capabilityTags: ['response'],
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
