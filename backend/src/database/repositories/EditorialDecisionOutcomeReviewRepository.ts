import type { EditorialDecisionOutcomeReview, Prisma, PrismaClient } from '@prisma/client';

export interface CreateOutcomeReviewData {
  sourceOutcomeId: string;
  previousSnapshotId: string;
  currentSnapshotId: string;
  reviewKey: string;
  reason: string;
  previousClassification: string;
  previousConfidence: number;
  changedMetrics: Prisma.InputJsonValue;
  previousState: Prisma.InputJsonValue;
}

const details = {
  sourceOutcome: true,
  resultOutcome: true,
  previousSnapshot: true,
  currentSnapshot: true,
} as const;

export type OutcomeReviewWithDetails = Prisma.EditorialDecisionOutcomeReviewGetPayload<{
  include: typeof details;
}>;

export class EditorialDecisionOutcomeReviewRepository {
  private readonly delegate: PrismaClient['editorialDecisionOutcomeReview'];

  constructor(client: PrismaClient) {
    this.delegate = client.editorialDecisionOutcomeReview;
  }

  async create(data: CreateOutcomeReviewData): Promise<EditorialDecisionOutcomeReview> {
    return this.delegate.create({ data });
  }

  async findByKey(reviewKey: string): Promise<OutcomeReviewWithDetails | null> {
    return this.delegate.findUnique({ where: { reviewKey }, include: details });
  }

  async complete(id: string, data: {
    resultOutcomeId: string;
    status: 'reviewed' | 'unchanged';
    currentClassification: string;
    currentConfidence: number;
    currentState: Prisma.InputJsonValue;
  }): Promise<OutcomeReviewWithDetails> {
    return this.delegate.update({
      where: { id },
      data: { ...data, completedAt: new Date(), errorType: null },
      include: details,
    });
  }

  async fail(id: string, errorType: string): Promise<OutcomeReviewWithDetails> {
    return this.delegate.update({
      where: { id },
      data: { status: 'failed', errorType, completedAt: new Date() },
      include: details,
    });
  }

  async findByOutcome(outcomeId: string): Promise<OutcomeReviewWithDetails[]> {
    return this.delegate.findMany({
      where: {
        OR: [
          { sourceOutcomeId: outcomeId },
          { resultOutcomeId: outcomeId },
        ],
      },
      include: details,
      orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
    });
  }

  async countRecentFailures(since: Date): Promise<number> {
    return this.delegate.count({ where: { status: 'failed', startedAt: { gte: since } } });
  }
}
