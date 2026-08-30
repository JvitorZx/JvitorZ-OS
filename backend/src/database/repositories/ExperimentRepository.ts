import type { Prisma, PrismaClient } from '@prisma/client';
import type { CreateExperimentInput, ExperimentAnalysis } from '../../domains/strategic-experimentation';

export const experimentDetails = {
  hypothesis: true,
  variants: { include: { plannedItem: true, executionEvent: true }, orderBy: [{ key: 'asc' }] },
  metrics: { orderBy: [{ role: 'asc' }, { name: 'asc' }] },
  constraints: { orderBy: [{ blocking: 'desc' }, { code: 'asc' }] },
  observations: { include: { variant: true, outcome: { include: { snapshot: true, item: true, executionEvent: true } } }, orderBy: [{ observedAt: 'asc' }, { id: 'asc' }] },
  result: { include: { evidence: { include: { observation: true, learning: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } },
  evidence: { include: { observation: true, learning: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  history: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] },
} satisfies Prisma.StrategicExperimentInclude;

export type StrategicExperimentWithDetails = Prisma.StrategicExperimentGetPayload<{ include: typeof experimentDetails }>;
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export class ExperimentRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(input: CreateExperimentInput): Promise<StrategicExperimentWithDetails> {
    const direction = input.metricDirection ?? 'HIGHER_BETTER';
    return this.client.strategicExperiment.create({ data: {
      projectId: input.projectId ?? null, sourceLearningId: input.sourceLearningId ?? null,
      title: input.title, description: input.description ?? null, context: json(input.context ?? {}),
      status: input.constraints?.some(({ blocking }) => blocking) ? 'DRAFT' : 'READY',
      primaryMetric: input.primaryMetric, secondaryMetrics: json(input.secondaryMetrics ?? []), risk: input.risk ?? null,
      comparisonCriterion: json(input.comparisonCriterion ?? {}), limitations: json([]),
      hypothesis: { create: { description: input.hypothesis, priorEvidence: json(input.priorEvidence ?? []), expectedVariantKey: input.expectedVariantKey } },
      variants: { create: input.variants.map((variant) => ({ key: variant.key, label: variant.label,
        description: variant.description ?? null, plannedItemId: variant.plannedItemId ?? null,
        executionEventId: variant.executionEventId ?? null })) },
      metrics: { create: [{ name: input.primaryMetric, role: 'PRIMARY', direction },
        ...(input.secondaryMetrics ?? []).filter((name) => name !== input.primaryMetric).map((name) => ({ name, role: 'SECONDARY', direction }))] },
      constraints: { create: (input.constraints ?? []).map(({ code, summary, blocking }) => ({ code, summary, blocking })) },
      history: { create: { event: 'EXPERIMENT_CREATED', reason: 'Hipotese registrada para teste controlado.', data: json({ primaryMetric: input.primaryMetric, variants: input.variants.map(({ key }) => key) }) } },
    }, include: experimentDetails });
  }

  async findAll(filters: { projectId?: string | null; status?: string; limit?: number } = {}) {
    return this.client.strategicExperiment.findMany({ where: {
      ...(filters.projectId !== undefined ? { projectId: filters.projectId } : {}), ...(filters.status ? { status: filters.status } : {}),
    }, include: { hypothesis: true, variants: true, result: true, _count: { select: { observations: true, evidence: true } } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: filters.limit ?? 100 });
  }

  async findById(id: string): Promise<StrategicExperimentWithDetails | null> {
    return this.client.strategicExperiment.findUnique({ where: { id }, include: experimentDetails });
  }

  async updateStatus(id: string, status: string, input: { reason?: string | null; startedAt?: Date; endedAt?: Date; data?: unknown } = {}) {
    return this.client.strategicExperiment.update({ where: { id }, data: { status,
      ...(input.startedAt ? { startedAt: input.startedAt } : {}), ...(input.endedAt ? { endedAt: input.endedAt } : {}),
      history: { create: { event: `EXPERIMENT_${status}`, reason: input.reason ?? null, data: json(input.data ?? {}) } },
    }, include: experimentDetails });
  }

  async linkVariant(variantId: string, plannedItemId: string | null, executionEventId: string | null) {
    return this.client.experimentVariant.update({ where: { id: variantId }, data: { plannedItemId, executionEventId } });
  }

  async saveAnalysis(id: string, analysis: ExperimentAnalysis, analyzedAt: Date): Promise<{ experiment: StrategicExperimentWithDetails; changed: boolean }> {
    return this.client.$transaction(async (transaction) => {
      const existing = await transaction.experimentResult.findUnique({ where: { experimentId: id } });
      if (existing?.analysisFingerprint === analysis.analysisFingerprint) {
        return { experiment: await transaction.strategicExperiment.findUniqueOrThrow({ where: { id }, include: experimentDetails }), changed: false };
      }
      await transaction.experimentEvidence.deleteMany({ where: { experimentId: id } });
      const result = await transaction.experimentResult.upsert({ where: { experimentId: id }, create: {
        experimentId: id, classification: analysis.classification, summary: analysis.summary, confidence: analysis.confidence,
        benchmark: json(analysis.benchmark), limitations: json(analysis.limitations), analysisFingerprint: analysis.analysisFingerprint, analyzedAt,
      }, update: { classification: analysis.classification, summary: analysis.summary, confidence: analysis.confidence,
        benchmark: json(analysis.benchmark), limitations: json(analysis.limitations), analysisFingerprint: analysis.analysisFingerprint, analyzedAt } });
      if (analysis.evidence.length) await transaction.experimentEvidence.createMany({ data: analysis.evidence.map((entry) => ({
        experimentId: id, resultId: result.id, observationId: entry.observationId, stance: entry.stance, summary: entry.summary,
      })) });
      await transaction.strategicExperiment.update({ where: { id }, data: { status: analysis.status,
        confidence: analysis.confidence, limitations: json(analysis.limitations), ...(analysis.status !== 'WAITING_FOR_DATA' ? { endedAt: analyzedAt } : {}),
        history: { create: { event: 'EXPERIMENT_ANALYZED', reason: analysis.summary,
          data: json({ classification: analysis.classification, confidence: analysis.confidence, fingerprint: analysis.analysisFingerprint }), createdAt: analyzedAt } },
      } });
      return { experiment: await transaction.strategicExperiment.findUniqueOrThrow({ where: { id }, include: experimentDetails }), changed: true };
    });
  }

  async attachLearningForOutcome(id: string, outcomeId: string, learningId: string) {
    return this.client.experimentEvidence.updateMany({ where: { experimentId: id, observation: { outcomeId }, learningId: null }, data: { learningId } });
  }

  async history(id: string) { return this.client.experimentEvent.findMany({ where: { experimentId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }); }
  async evidence(id: string) { return this.client.experimentEvidence.findMany({ where: { experimentId: id }, include: { observation: { include: { outcome: true, variant: true } }, learning: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }); }
}
