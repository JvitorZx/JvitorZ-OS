import { createHash } from 'crypto';
import type { OrchestrationExecution, PlanReview, Prisma } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { OrchestrationExecutionRepository } from '../../database/repositories/OrchestrationExecutionRepository';
import { PlanReviewRepository } from '../../database/repositories/PlanReviewRepository';
import type {
  OrchestrationPlan,
  OrchestrationRequest,
  PlanPreview,
  PlanReviewState,
} from '../../domains/orchestration';
import { classifyPlanRisk } from './PlanRiskClassifier';

export class PlanReviewNotFoundError extends Error {
  constructor() { super('Plan review not found'); this.name = 'PlanReviewNotFoundError'; }
}

export class PlanReviewConflictError extends Error {
  constructor(message = 'Plan review state changed') { super(message); this.name = 'PlanReviewConflictError'; }
}

export class PlanReviewValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'PlanReviewValidationError'; }
}

export class PlanReviewRequiredError extends Error {
  constructor(public readonly executionId: string) {
    super('Plan requires explicit approval before execution');
    this.name = 'PlanReviewRequiredError';
  }
}

export class PlanReviewExpiredError extends Error {
  constructor() { super('Plan approval is expired or no longer matches the plan'); this.name = 'PlanReviewExpiredError'; }
}

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
};

export const hashOrchestrationPlan = (plan: OrchestrationPlan): string => createHash('sha256')
  .update(JSON.stringify(stable(plan)))
  .digest('hex');

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const normalizeText = (value: unknown, field: string, required: boolean, max: number): string | null => {
  if (value === undefined || value === null) {
    if (required) throw new PlanReviewValidationError(`${field} is required`);
    return null;
  }
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > max) {
    throw new PlanReviewValidationError(`${field} must be a non-empty string up to ${max} characters`);
  }
  return value.trim();
};

export class PlanReviewService {
  private executionRepository?: OrchestrationExecutionRepository;
  private reviewRepository?: PlanReviewRepository;

  constructor(
    executionRepository?: OrchestrationExecutionRepository,
    reviewRepository?: PlanReviewRepository,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.executionRepository = executionRepository;
    this.reviewRepository = reviewRepository;
  }

  private get executions(): OrchestrationExecutionRepository {
    if (!this.executionRepository) this.executionRepository = new OrchestrationExecutionRepository(DatabaseService.client);
    return this.executionRepository;
  }

  private get reviews(): PlanReviewRepository {
    if (!this.reviewRepository) this.reviewRepository = new PlanReviewRepository(DatabaseService.client);
    return this.reviewRepository;
  }

  async preview(request: OrchestrationRequest, plan: OrchestrationPlan): Promise<PlanPreview> {
    if (request.idempotencyKey) {
      const existing = await this.executions.findByIdempotencyKey(request.idempotencyKey);
      if (existing) {
        const review = await this.reviews.findByExecutionId(existing.id);
        if (!review) throw new PlanReviewConflictError('Idempotent execution has no plan review');
        return this.toPreview(existing, await this.expireIfNeeded(review), plan, false);
      }
    }
    const assessment = classifyPlanRisk(plan);
    const planHash = hashOrchestrationPlan(plan);
    const autoApproved = assessment.requiredApprovals === 0;
    const current = this.now();
    const validUntil = new Date(current.getTime() + assessment.validityMinutes * 60_000);
    const created = await this.reviews.createPreview({
      projectId: request.projectId ?? null,
      conversationId: request.conversationId ?? null,
      idempotencyKey: request.idempotencyKey ?? null,
      intent: plan.intent,
      objective: plan.objective,
      capabilities: json(plan.capabilities),
      request: json(request),
      plan: json(plan),
      failures: [],
    }, {
      state: autoApproved ? 'approved' : 'review_required',
      reviewer: autoApproved ? 'policy:auto' : null,
      reviewedAt: autoApproved ? current : null,
      decision: autoApproved ? 'auto_approved' : null,
      reason: autoApproved ? 'Default policy permits this bounded plan' : null,
      riskLevel: assessment.riskLevel,
      sideEffectLevel: assessment.sideEffectLevel,
      requiredApprovals: assessment.requiredApprovals,
      planHash,
      approvedPlanHash: autoApproved ? planHash : null,
      ...(autoApproved ? { approvedPlan: json(plan) } : {}),
      validUntil,
    }, [
      { eventType: 'PLAN_CREATED', details: json({ intent: plan.intent, capabilities: plan.capabilities,
        riskLevel: assessment.riskLevel, sideEffectLevel: assessment.sideEffectLevel }) },
      ...(autoApproved ? [{ eventType: 'PLAN_APPROVED', actor: 'policy:auto',
        reason: 'Default policy permits this bounded plan' }] : []),
    ]);
    return this.toPreview(created.execution, created.review, plan, true, assessment.reasons);
  }

  private toPreview(
    execution: OrchestrationExecution,
    review: PlanReview,
    plan: OrchestrationPlan,
    created: boolean,
    reasons: string[] = classifyPlanRisk(plan).reasons,
  ): PlanPreview {
    return {
      executionId: execution.id,
      plan,
      review: {
        state: review.state as PlanReviewState,
        riskLevel: review.riskLevel as PlanPreview['review']['riskLevel'],
        sideEffectLevel: review.sideEffectLevel as PlanPreview['review']['sideEffectLevel'],
        requiredApprovals: review.requiredApprovals,
        version: review.version,
        reasons,
        validUntil: review.validUntil,
      },
      created,
    };
  }

  private async expireIfNeeded(review: PlanReview): Promise<PlanReview> {
    if (!['review_required', 'approved'].includes(review.state) || review.validUntil.getTime() > this.now().getTime()) {
      return review;
    }
    return await this.reviews.transition({
      executionId: review.executionId,
      expectedStates: [review.state],
      expectedVersion: review.version,
      data: { state: 'expired', decision: 'expired', reason: 'Plan validity window elapsed', reviewedAt: this.now() },
      audit: { eventType: 'PLAN_EXPIRED', reason: 'Plan validity window elapsed' },
    }) ?? await this.requireReview(review.executionId);
  }

  private async requireReview(executionId: string): Promise<PlanReview> {
    const review = await this.reviews.findByExecutionId(executionId);
    if (!review) throw new PlanReviewNotFoundError();
    return review;
  }

  async getReview(executionId: string): Promise<PlanReview> {
    return this.expireIfNeeded(await this.requireReview(executionId));
  }

  async approve(input: {
    executionId: string;
    reviewer: unknown;
    reason?: unknown;
    expectedVersion: number;
  }): Promise<{ review: PlanReview; changed: boolean }> {
    const reviewer = normalizeText(input.reviewer, 'reviewer', true, 100) as string;
    const reason = normalizeText(input.reason, 'reason', false, 500);
    const execution = await this.executions.findById(input.executionId);
    if (!execution) throw new PlanReviewNotFoundError();
    const review = await this.getReview(input.executionId);
    const plan = execution.plan as unknown as OrchestrationPlan;
    const currentHash = hashOrchestrationPlan(plan);
    if (review.state === 'approved') {
      if (review.approvedPlanHash === review.planHash && currentHash === review.planHash) {
        return { review, changed: false };
      }
      await this.expire(input.executionId, 'Approved plan no longer matches current plan');
      throw new PlanReviewExpiredError();
    }
    if (review.state === 'expired') throw new PlanReviewExpiredError();
    if (review.state !== 'review_required') throw new PlanReviewConflictError(`Plan is ${review.state}`);
    if (currentHash !== review.planHash) {
      await this.expire(input.executionId, 'Plan changed before approval');
      throw new PlanReviewExpiredError();
    }
    const changed = await this.reviews.transition({
      executionId: input.executionId,
      expectedStates: ['review_required'],
      expectedVersion: input.expectedVersion,
      data: {
        state: 'approved', reviewer, reviewedAt: this.now(), decision: 'approved', reason,
        approvedPlanHash: currentHash, approvedPlan: json(plan),
      },
      audit: { eventType: 'PLAN_APPROVED', actor: reviewer, reason },
    });
    if (!changed) {
      const latest = await this.getReview(input.executionId);
      if (latest.state === 'approved') return { review: latest, changed: false };
      throw new PlanReviewConflictError();
    }
    return { review: changed, changed: true };
  }

  async reject(input: {
    executionId: string;
    reviewer: unknown;
    reason: unknown;
    expectedVersion: number;
  }): Promise<{ review: PlanReview; changed: boolean }> {
    const reviewer = normalizeText(input.reviewer, 'reviewer', true, 100) as string;
    const reason = normalizeText(input.reason, 'reason', true, 500) as string;
    const review = await this.getReview(input.executionId);
    if (review.state === 'rejected') return { review, changed: false };
    if (review.state === 'expired') throw new PlanReviewExpiredError();
    if (review.state !== 'review_required') throw new PlanReviewConflictError(`Plan is ${review.state}`);
    const changed = await this.reviews.transition({
      executionId: input.executionId,
      expectedStates: ['review_required'], expectedVersion: input.expectedVersion,
      data: { state: 'rejected', reviewer, reviewedAt: this.now(), decision: 'rejected', reason },
      audit: { eventType: 'PLAN_REJECTED', actor: reviewer, reason },
    });
    if (!changed) throw new PlanReviewConflictError();
    return { review: changed, changed: true };
  }

  async expire(executionId: string, reason = 'Plan validity invalidated'): Promise<PlanReview> {
    const review = await this.requireReview(executionId);
    if (review.state === 'expired') return review;
    if (!['review_required', 'approved'].includes(review.state)) {
      throw new PlanReviewConflictError(`Plan is ${review.state}`);
    }
    const changed = await this.reviews.transition({
      executionId, expectedStates: [review.state], expectedVersion: review.version,
      data: { state: 'expired', reviewedAt: this.now(), decision: 'expired', reason },
      audit: { eventType: 'PLAN_EXPIRED', reason },
    });
    if (!changed) throw new PlanReviewConflictError();
    return changed;
  }

  async assertExecutable(execution: OrchestrationExecution, plan: OrchestrationPlan): Promise<PlanReview> {
    await this.reviews.addAuditEvent(execution.id, { eventType: 'EXECUTION_ATTEMPTED' });
    const review = await this.getReview(execution.id);
    const block = async (reason: string, error: Error): Promise<never> => {
      await this.reviews.addAuditEvent(execution.id, { eventType: 'EXECUTION_BLOCKED', reason });
      throw error;
    };
    if (review.state === 'expired') return block('Plan approval expired', new PlanReviewExpiredError());
    if (review.state !== 'approved') {
      return block(`Plan is ${review.state}`, new PlanReviewRequiredError(execution.id));
    }
    const currentHash = hashOrchestrationPlan(plan);
    if (!review.approvedPlanHash || currentHash !== review.planHash || currentHash !== review.approvedPlanHash) {
      await this.expire(execution.id, 'Approved plan no longer matches current plan');
      return block('Plan version changed after approval', new PlanReviewExpiredError());
    }
    return review;
  }

  async markExecuted(executionId: string, review: PlanReview): Promise<void> {
    const changed = await this.reviews.transition({
      executionId, expectedStates: ['approved'], expectedVersion: review.version,
      data: { state: 'executed', reviewedAt: this.now() },
      audit: { eventType: 'PLAN_EXECUTED' },
    });
    if (!changed) throw new PlanReviewConflictError('Plan execution state changed');
  }

  async recordExecutionBlocked(executionId: string, reason: string): Promise<void> {
    await this.reviews.addAuditEvent(executionId, { eventType: 'EXECUTION_BLOCKED', reason });
  }

  async getAuditTrail(executionId: string) {
    await this.requireReview(executionId);
    return this.reviews.findAuditTrail(executionId);
  }

  async getOperationalSummary() {
    return this.reviews.getOperationalSummary();
  }
}
