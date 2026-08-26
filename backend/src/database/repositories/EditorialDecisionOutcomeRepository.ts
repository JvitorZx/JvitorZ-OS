import type { EditorialDecisionOutcome, Prisma, PrismaClient } from '@prisma/client';

export interface SaveEditorialDecisionOutcomeData {
  decisionVideoLinkId: string;
  snapshotId: string;
  learningInsightId?: string | null;
  windowStart: Date | null;
  windowEnd: Date | null;
  baseline: Prisma.InputJsonValue;
  facts: Prisma.InputJsonValue;
  comparison: Prisma.InputJsonValue;
  interpretation: Prisma.InputJsonValue;
  confidence: number;
  classification: string;
  supportingMetrics: Prisma.InputJsonValue;
  contradictingMetrics: Prisma.InputJsonValue;
  missingData: Prisma.InputJsonValue;
  hypotheses: Prisma.InputJsonValue;
  evaluatedAt: Date;
}

export type EditorialDecisionOutcomeWithDetails = Prisma.EditorialDecisionOutcomeGetPayload<{
  include: {
    decisionVideoLink: { include: { decision: true } };
    snapshot: true;
    learningInsight: true;
  };
}>;

const details = {
  decisionVideoLink: { include: { decision: true } },
  snapshot: true,
  learningInsight: true,
} as const;

export class EditorialDecisionOutcomeRepository {
  private readonly delegate: PrismaClient['editorialDecisionOutcome'];

  constructor(client: PrismaClient) {
    this.delegate = client.editorialDecisionOutcome;
  }

  async upsert(data: SaveEditorialDecisionOutcomeData): Promise<{
    outcome: EditorialDecisionOutcome;
    created: boolean;
  }> {
    const where = {
      decisionVideoLinkId_snapshotId: {
        decisionVideoLinkId: data.decisionVideoLinkId,
        snapshotId: data.snapshotId,
      },
    };
    const existing = await this.delegate.findUnique({ where });
    const outcome = await this.delegate.upsert({
      where,
      create: data,
      update: data,
    });
    return { outcome, created: existing === null };
  }

  async attachLearning(id: string, learningInsightId: string): Promise<EditorialDecisionOutcome> {
    return this.delegate.update({ where: { id }, data: { learningInsightId } });
  }

  async findById(id: string): Promise<EditorialDecisionOutcomeWithDetails | null> {
    return this.delegate.findUnique({ where: { id }, include: details });
  }

  async findByLink(decisionVideoLinkId: string): Promise<EditorialDecisionOutcomeWithDetails[]> {
    return this.delegate.findMany({
      where: { decisionVideoLinkId },
      include: details,
      orderBy: [{ evaluatedAt: 'desc' }, { id: 'asc' }],
    });
  }

  async findAll(filters: {
    projectId?: string | null;
    conversationId?: string | null;
    decisionId?: string;
    videoId?: string;
    limit?: number;
  } = {}): Promise<EditorialDecisionOutcomeWithDetails[]> {
    const decision: Prisma.EditorialDecisionWhereInput = {};
    if ('projectId' in filters) decision.projectId = filters.projectId;
    if ('conversationId' in filters) decision.conversationId = filters.conversationId;
    if (filters.decisionId) decision.id = filters.decisionId;
    const where: Prisma.EditorialDecisionOutcomeWhereInput = {
      decisionVideoLink: {
        ...(Object.keys(decision).length > 0 ? { decision } : {}),
        ...(filters.videoId ? { videoId: filters.videoId } : {}),
      },
    };
    return this.delegate.findMany({
      where,
      include: details,
      orderBy: [{ evaluatedAt: 'desc' }, { id: 'asc' }],
      take: filters.limit ?? 20,
    });
  }
}
