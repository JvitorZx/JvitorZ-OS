import type { Prisma, PrismaClient } from '@prisma/client';
import type { StrategicLearningAnalysis } from '../../domains/strategic-learning';

const outcomeTrace = {
  snapshot: true,
  link: true,
  executionEvent: true,
  item: { include: { plan: true } },
} satisfies Prisma.PlanningOutcomeInclude;

const learningDetails = {
  evidence: {
    include: { outcome: { include: outcomeTrace } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
  revisions: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] },
} satisfies Prisma.StrategicLearningInclude;

export type StrategicLearningWithDetails = Prisma.StrategicLearningGetPayload<{ include: typeof learningDetails }>;
export type LearningOutcomeSource = Prisma.PlanningOutcomeGetPayload<{ include: typeof outcomeTrace }>;

export interface StrategicLearningFilters {
  projectId?: string | null;
  status?: string;
  dimension?: string;
  limit?: number;
}

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const snapshot = (analysis: StrategicLearningAnalysis): Prisma.InputJsonValue => json({
  direction: analysis.direction, status: analysis.status, observationCount: analysis.observationCount,
  favorableCount: analysis.favorableCount, neutralCount: analysis.neutralCount,
  contraryCount: analysis.contraryCount, confidence: analysis.confidence, freshness: analysis.freshness,
  outcomeIds: analysis.evidence.map(({ outcomeId }) => outcomeId),
});

export class StrategicLearningRepository {
  constructor(private readonly client: PrismaClient) {}

  async findEligibleOutcomes(projectId?: string | null): Promise<LearningOutcomeSource[]> {
    return this.client.planningOutcome.findMany({
      where: {
        ...(projectId !== undefined ? { projectId } : {}),
        classification: { in: ['ABOVE_REFERENCE', 'WITHIN_REFERENCE', 'BELOW_REFERENCE'] },
        link: { activeItemKey: { not: null } },
      },
      include: outcomeTrace,
      orderBy: [{ observedAt: 'asc' }, { id: 'asc' }],
    });
  }

  async saveAnalysis(analysis: StrategicLearningAnalysis): Promise<{
    learning: StrategicLearningWithDetails;
    change: 'created' | 'updated' | 'unchanged';
  }> {
    return this.client.$transaction(async (transaction) => {
      const existing = await transaction.strategicLearning.findUnique({ where: { key: analysis.key } });
      if (existing?.analysisFingerprint === analysis.analysisFingerprint) {
        return {
          learning: await transaction.strategicLearning.findUniqueOrThrow({ where: { id: existing.id }, include: learningDetails }),
          change: 'unchanged' as const,
        };
      }
      const data = {
        projectId: analysis.projectId, dimension: analysis.dimension, subject: analysis.subject,
        comparisonContext: json(analysis.comparisonContext), description: analysis.description,
        direction: analysis.direction, status: analysis.status, observationCount: analysis.observationCount,
        favorableCount: analysis.favorableCount, neutralCount: analysis.neutralCount,
        contraryCount: analysis.contraryCount, confidence: analysis.confidence, freshness: analysis.freshness,
        benchmark: json(analysis.benchmark), limitations: json(analysis.limitations),
        analysisFingerprint: analysis.analysisFingerprint, firstObservedAt: analysis.firstObservedAt,
        lastObservedAt: analysis.lastObservedAt,
      };
      if (!existing) {
        const learning = await transaction.strategicLearning.create({
          data: {
            key: analysis.key, ...data,
            evidence: { create: analysis.evidence.map((entry) => ({ outcomeId: entry.outcomeId, stance: entry.stance, summary: entry.summary })) },
            revisions: { create: { event: 'LEARNING_CREATED', reason: 'Primeira analise deste grupo comparavel.',
              currentStatus: analysis.status, currentConfidence: analysis.confidence, after: snapshot(analysis) } },
          }, include: learningDetails,
        });
        return { learning, change: 'created' as const };
      }
      await transaction.strategicLearningEvidence.deleteMany({ where: { learningId: existing.id } });
      await transaction.strategicLearning.update({
        where: { id: existing.id }, data: {
          ...data,
          evidence: { create: analysis.evidence.map((entry) => ({ outcomeId: entry.outcomeId, stance: entry.stance, summary: entry.summary })) },
          revisions: { create: { event: 'LEARNING_REEVALUATED', reason: 'Novas evidencias alteraram a interpretacao persistida.',
            previousStatus: existing.status, currentStatus: analysis.status, previousConfidence: existing.confidence,
            currentConfidence: analysis.confidence,
            before: json({ status: existing.status, confidence: existing.confidence, analysisFingerprint: existing.analysisFingerprint }),
            after: snapshot(analysis) } },
        },
      });
      return {
        learning: await transaction.strategicLearning.findUniqueOrThrow({ where: { id: existing.id }, include: learningDetails }),
        change: 'updated' as const,
      };
    });
  }

  async markAbsentAsStale(projectId: string | null | undefined, activeKeys: readonly string[], now: Date): Promise<number> {
    const missing = await this.client.strategicLearning.findMany({ where: {
      ...(projectId !== undefined ? { projectId } : {}), key: { notIn: [...activeKeys] }, status: { not: 'STALE' },
    } });
    for (const learning of missing) {
      const currentLimitations = Array.isArray(learning.limitations) ? learning.limitations : [];
      await this.client.strategicLearning.update({ where: { id: learning.id }, data: {
        status: 'STALE', freshness: 'STALE',
        limitations: json([...currentLimitations, 'O grupo nao possui mais outcomes ativos e nao deve orientar decisoes atuais.']),
        revisions: { create: { event: 'LEARNING_STALE', reason: 'Os outcomes que sustentavam o grupo nao estao mais ativos.',
          previousStatus: learning.status, currentStatus: 'STALE', previousConfidence: learning.confidence,
          currentConfidence: learning.confidence,
          before: json({ status: learning.status, freshness: learning.freshness }), after: json({ status: 'STALE', freshness: 'STALE' }),
          createdAt: now } },
      } });
    }
    return missing.length;
  }

  async findAll(filters: StrategicLearningFilters = {}) {
    return this.client.strategicLearning.findMany({
      where: {
        ...(filters.projectId !== undefined ? { projectId: filters.projectId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.dimension ? { dimension: filters.dimension } : {}),
      },
      include: { _count: { select: { evidence: true, revisions: true } } },
      orderBy: [{ confidence: 'desc' }, { observationCount: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }],
      take: filters.limit ?? 100,
    });
  }

  async findById(id: string): Promise<StrategicLearningWithDetails | null> {
    return this.client.strategicLearning.findUnique({ where: { id }, include: learningDetails });
  }

  async findEvidence(id: string) {
    return this.client.strategicLearningEvidence.findMany({ where: { learningId: id }, include: { outcome: { include: outcomeTrace } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  async findHistory(id: string) {
    return this.client.strategicLearningRevision.findMany({ where: { learningId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
  }

  async findRelated(filters: { itemId?: string; planId?: string; outcomeId?: string; videoId?: string }) {
    return this.client.strategicLearning.findMany({ where: { evidence: { some: { outcome: {
      ...(filters.itemId ? { itemId: filters.itemId } : {}), ...(filters.planId ? { planId: filters.planId } : {}),
      ...(filters.outcomeId ? { id: filters.outcomeId } : {}), ...(filters.videoId ? { videoId: filters.videoId } : {}),
    } } } }, include: { _count: { select: { evidence: true, revisions: true } } },
    orderBy: [{ confidence: 'desc' }, { id: 'asc' }] });
  }
}
