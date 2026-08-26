import type {
  OrchestrationAuditEvent,
  OrchestrationExecution,
  PlanReview,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import type { CreateOrchestrationExecutionData } from './OrchestrationExecutionRepository';

export interface CreatePlanReviewData {
  state: string;
  reviewer?: string | null;
  reviewedAt?: Date | null;
  decision?: string | null;
  reason?: string | null;
  riskLevel: string;
  sideEffectLevel: string;
  requiredApprovals: number;
  planHash: string;
  approvedPlanHash?: string | null;
  approvedPlan?: Prisma.InputJsonValue;
  validUntil: Date;
}

export interface AuditEventInput {
  eventType: string;
  actor?: string | null;
  reason?: string | null;
  details?: Prisma.InputJsonValue;
}

export class PlanReviewRepository {
  constructor(private readonly client: PrismaClient) {}

  async createPreview(
    execution: CreateOrchestrationExecutionData,
    review: CreatePlanReviewData,
    auditEvents: AuditEventInput[],
  ): Promise<{ execution: OrchestrationExecution; review: PlanReview }> {
    const created = await this.client.orchestrationExecution.create({
      data: {
        ...execution,
        review: { create: review },
        auditEvents: { create: auditEvents },
      },
      include: { review: true },
    });
    if (!created.review) throw new Error('Plan review was not persisted');
    return { execution: created, review: created.review };
  }

  async findByExecutionId(executionId: string): Promise<PlanReview | null> {
    return this.client.planReview.findUnique({ where: { executionId } });
  }

  async transition(input: {
    executionId: string;
    expectedStates: string[];
    expectedVersion: number;
    data: Prisma.PlanReviewUpdateManyMutationInput;
    audit: AuditEventInput;
  }): Promise<PlanReview | null> {
    return this.client.$transaction(async (transaction) => {
      const changed = await transaction.planReview.updateMany({
        where: {
          executionId: input.executionId,
          state: { in: input.expectedStates },
          version: input.expectedVersion,
        },
        data: { ...input.data, version: { increment: 1 } },
      });
      if (changed.count !== 1) return null;
      await transaction.orchestrationAuditEvent.create({
        data: { executionId: input.executionId, ...input.audit },
      });
      return transaction.planReview.findUnique({ where: { executionId: input.executionId } });
    });
  }

  async addAuditEvent(executionId: string, event: AuditEventInput): Promise<OrchestrationAuditEvent> {
    return this.client.orchestrationAuditEvent.create({ data: { executionId, ...event } });
  }

  async findAuditTrail(executionId: string): Promise<OrchestrationAuditEvent[]> {
    return this.client.orchestrationAuditEvent.findMany({
      where: { executionId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async getOperationalSummary(): Promise<{
    awaitingReview: number;
    approved: number;
    rejected: number;
    expired: number;
    executedRecently: number;
    blockedRecently: number;
  }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1_000);
    const [awaitingReview, approved, rejected, expired, executedRecently, blockedRecently] = await Promise.all([
      this.client.planReview.count({ where: { state: 'review_required' } }),
      this.client.planReview.count({ where: { state: 'approved' } }),
      this.client.planReview.count({ where: { state: 'rejected' } }),
      this.client.planReview.count({ where: { state: 'expired' } }),
      this.client.planReview.count({ where: { state: 'executed', reviewedAt: { gte: since } } }),
      this.client.orchestrationAuditEvent.count({
        where: { eventType: 'EXECUTION_BLOCKED', createdAt: { gte: since } },
      }),
    ]);
    return { awaitingReview, approved, rejected, expired, executedRecently, blockedRecently };
  }
}
