import { DatabaseService } from '../../database/DatabaseService';
import { ContentPlanRepository } from '../../database/repositories/ContentPlanRepository';
import { ExperimentRepository } from '../../database/repositories/ExperimentRepository';
import { ResearchOpportunityRepository } from '../../database/repositories/ResearchOpportunityRepository';
import { SeriesDefinitionRepository } from '../../database/repositories/SeriesDefinitionRepository';
import { StrategicLearningRepository } from '../../database/repositories/StrategicLearningRepository';
import { TrendSignalRepository } from '../../database/repositories/TrendSignalRepository';
import {
  STRATEGIC_MONITORING_POLICY,
  type MonitoringFact,
  type MonitoringSourceResult,
  type StrategicMonitoringSource,
} from '../../domains/strategic-monitoring';
import { ChannelOperatorService } from '../channel-operators';
import { SeriesIntelligenceService } from '../trend-intelligence/SeriesIntelligenceService';
import { ChannelContextResolver } from '../channel-context';

const strings = (value: unknown): string[] => Array.isArray(value)
  ? value.flatMap((entry) => typeof entry === 'string' ? [entry] : [])
  : [];
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

export class PersistedStrategicMonitoringSource implements StrategicMonitoringSource {
  constructor(
    private readonly trends = new TrendSignalRepository(DatabaseService.client),
    private readonly seriesDefinitions = new SeriesDefinitionRepository(DatabaseService.client),
    private readonly series = new SeriesIntelligenceService(),
    private readonly opportunities = new ResearchOpportunityRepository(DatabaseService.client),
    private readonly plans = new ContentPlanRepository(DatabaseService.client),
    private readonly learnings = new StrategicLearningRepository(DatabaseService.client),
    private readonly experiments = new ExperimentRepository(DatabaseService.client),
    private readonly operators: Pick<ChannelOperatorService, 'run'> = new ChannelOperatorService(),
    private readonly contextResolver: Pick<ChannelContextResolver, 'resolve'> = new ChannelContextResolver(),
  ) {}

  async collect(projectId: string | null, now: Date): Promise<MonitoringSourceResult> {
    const facts: MonitoringFact[] = [];
    const evaluatedSources: string[] = [];
    const sourceState: Record<string, 'AVAILABLE' | 'DEGRADED'> = {};
    const attempt = async (source: string, work: () => Promise<void>) => {
      try {
        await work();
        evaluatedSources.push(source);
        sourceState[source] = 'AVAILABLE';
      } catch {
        sourceState[source] = 'DEGRADED';
        facts.push({
          type: 'DATA_QUALITY_DEGRADED', source, sourceId: 'collector', subject: source,
          stateValue: 'DEGRADED', summary: `${source} nao pode ser avaliado nesta execucao controlada.`,
          impact: 'Os sinais anteriores desta fonte permanecem preservados ate uma avaliacao completa.', confidence: 1,
          limitations: ['A fonte local falhou; nenhum estado anterior foi resolvido automaticamente.'],
          evidence: ['Falha interna sanitizada durante a leitura da fonte persistida.'], observedAt: now,
        });
      }
    };

    await attempt('TRENDS', async () => {
      for (const row of await this.trends.findAll({ projectId })) {
        if (!['RISING', 'DECLINING'].includes(row.classification)) continue;
        const quality = object(row.quality);
        facts.push({
          type: row.classification === 'RISING' ? 'TREND_RISING' : 'TREND_DECLINING',
          source: 'TRENDS', sourceId: row.id, subject: row.subject, stateValue: row.classification,
          summary: `${row.metric} de ${row.subject} foi classificado como ${row.classification} em janelas comparaveis.`,
          impact: row.classification === 'RISING'
            ? 'A mudanca observada pode merecer acompanhamento editorial.'
            : 'A mudanca observada pode exigir revisao antes de repetir a mesma estrategia.',
          confidence: row.confidence,
          limitations: strings(quality.reasons),
          evidence: [`Amostra ${row.sampleSize}; delta observado ${row.delta ?? 'indisponivel'}.`],
          observedAt: row.detectedAt,
          metadata: { metric: row.metric, subjectType: row.subjectType, delta: row.delta, sampleSize: row.sampleSize },
        });
      }
    });

    await attempt('SERIES', async () => {
      const definitions = await this.seriesDefinitions.findAll(projectId);
      for (const definition of definitions) {
        const { health } = await this.series.getById(definition.id, now);
        if (!['DECLINING', 'DORMANT'].includes(health.health)) continue;
        facts.push({
          type: health.health === 'DECLINING' ? 'SERIES_DECLINING' : 'SERIES_DORMANT',
          source: 'SERIES', sourceId: definition.id, subject: definition.name, stateValue: health.health,
          summary: `A serie ${definition.name} foi classificada como ${health.health}.`,
          impact: health.health === 'DECLINING'
            ? 'A continuidade da serie merece revisao com as evidencias atuais.'
            : 'A serie nao possui episodio dentro da janela recente do dominio temporal.',
          confidence: health.confidence,
          limitations: health.missingData,
          evidence: health.reasons,
          observedAt: health.lastPublishedAt ?? now,
          metadata: { sampleSize: health.sampleSize, trend: health.trend },
        });
      }
    });

    await attempt('RESEARCH', async () => {
      for (const row of await this.opportunities.findAll({ projectId, limit: 200 })) {
        const stale = row.freshness === 'STALE' || row.researchHistory.validUntil <= now;
        const hoursRemaining = (row.researchHistory.validUntil.getTime() - now.getTime()) / 3_600_000;
        if (!stale && (hoursRemaining <= 0 || hoursRemaining > STRATEGIC_MONITORING_POLICY.opportunityExpiringHours)) continue;
        facts.push({
          type: stale ? 'OPPORTUNITY_STALE' : 'OPPORTUNITY_EXPIRING',
          source: 'RESEARCH', sourceId: row.id, subject: row.subject,
          stateValue: stale ? 'STALE' : 'EXPIRING',
          summary: stale ? `A oportunidade ${row.subject} esta stale.` : `A oportunidade ${row.subject} esta proxima do validUntil.`,
          impact: 'A evidencia deve ser reavaliada antes de orientar uma nova decisao editorial.',
          confidence: row.confidence,
          limitations: strings(row.gaps),
          evidence: [row.summary], observedAt: row.researchHistory.researchedAt,
          metadata: { validUntil: row.researchHistory.validUntil.toISOString(), freshness: row.freshness, state: row.state },
        });
      }
    });

    await attempt('PLANNING', async () => {
      const plan = await this.plans.findCurrent({ projectId });
      for (const item of plan?.items ?? []) {
        if (item.queue !== 'BLOCKED' && item.readiness !== 'BLOCKED') continue;
        facts.push({
          type: 'PLANNING_BLOCKED', source: 'PLANNING', sourceId: item.id, subject: item.title,
          stateValue: `${item.queue}:${item.readiness}`, summary: `O item ${item.title} esta bloqueado no plano atual.`,
          impact: 'O bloqueio impede que este item avance normalmente na fila editorial.',
          confidence: item.executionConfidence ?? 1,
          limitations: strings(item.missingData),
          evidence: strings(item.constraints).length ? strings(item.constraints) : [item.rationale],
          observedAt: item.updatedAt,
          metadata: { planId: item.planId, queue: item.queue, readiness: item.readiness, dependencies: item.dependencies },
        });
      }
    });

    await attempt('EXPERIMENTS', async () => {
      for (const row of await this.experiments.findAll({ projectId, status: 'INCONCLUSIVE', limit: 200 })) {
        facts.push({
          type: 'EXPERIMENT_INCONCLUSIVE', source: 'EXPERIMENTS', sourceId: row.id, subject: row.title,
          stateValue: row.result?.classification ?? row.status,
          summary: `O experimento ${row.title} terminou inconclusivo.`,
          impact: 'O teste nao sustenta uma conclusao estrategica com os dados atuais.',
          confidence: row.result?.confidence ?? 0,
          limitations: Array.isArray(row.result?.limitations) ? strings(row.result?.limitations) : [],
          evidence: row.result?.summary ? [row.result.summary] : ['Resultado sem evidencia comparavel suficiente.'],
          observedAt: row.result?.analyzedAt ?? row.updatedAt,
          metadata: { primaryMetric: row.primaryMetric },
        });
      }
    });

    await attempt('LEARNINGS', async () => {
      for (const row of await this.learnings.findAll({ projectId, limit: 200 })) {
        if (!['CONTRADICTED', 'STALE'].includes(row.status)) continue;
        facts.push({
          type: row.status === 'CONTRADICTED' ? 'LEARNING_CONTRADICTED' : 'LEARNING_STALE',
          source: 'LEARNINGS', sourceId: row.id, subject: `${row.dimension}:${row.subject}`,
          stateValue: row.status, summary: row.status === 'CONTRADICTED'
            ? `O aprendizado ${row.subject} possui evidencias contraditorias.`
            : `O aprendizado ${row.subject} esta stale.`,
          impact: row.status === 'CONTRADICTED'
            ? 'A interpretacao anterior deve ser apresentada com menor certeza.'
            : 'A evidencia pode nao representar o estado atual do canal.',
          confidence: row.confidence,
          limitations: strings(row.limitations),
          evidence: [row.description], observedAt: row.lastObservedAt,
          metadata: { dimension: row.dimension, observationCount: row.observationCount, direction: row.direction },
        });
      }
    });

    await attempt('DATA_QUALITY', async () => {
      for (const operatorId of ['ctr', 'retention'] as const) {
        const analysis = await this.operators.run(operatorId, projectId);
        const quality = analysis.quality;
        const type = analysis.status === 'NOT_CONFIGURED' ? 'DATA_MISSING'
          : quality?.freshness === 'STALE' ? 'DATA_STALE'
            : analysis.status === 'LIMITED' || ['ERROR', 'INCONSISTENT'].includes(quality?.state ?? '')
              ? 'DATA_QUALITY_DEGRADED' : null;
        if (!type) continue;
        facts.push({
          type, source: 'DATA_QUALITY', sourceId: operatorId, subject: analysis.name,
          stateValue: `${analysis.status}:${quality?.state ?? 'MISSING'}:${quality?.freshness ?? 'MISSING'}`,
          summary: `${analysis.name} esta ${analysis.status.toLowerCase()} com qualidade ${quality?.state ?? 'MISSING'}.`,
          impact: 'Recomendacoes dependentes desta fonte devem declarar a limitacao de dados.',
          confidence: analysis.confidence,
          limitations: analysis.missingData,
          evidence: quality?.reasons.map(({ message }) => message) ?? analysis.signals.map(({ summary }) => summary),
          observedAt: analysis.lastDataAt ?? now,
          metadata: { sampleSize: analysis.sampleSize, quality: quality ?? null },
        });
      }
    });

    for (const fact of facts) {
      try {
        const related = await this.contextResolver.resolve({
          projectId, text: `${fact.subject} ${fact.summary}`, entityType: fact.source, entityId: fact.sourceId,
          limit: 3, maxCharacters: 2_000,
        });
        if (related.entries.length) fact.metadata = { ...(fact.metadata ?? {}), channelContextIds: related.entries.map(({ id }) => id) };
      } catch {
        // Context linkage is optional enrichment and cannot hide a valid monitoring fact.
      }
    }
    return { facts, evaluatedSources: [...new Set(evaluatedSources)].sort(), sourceState };
  }
}
