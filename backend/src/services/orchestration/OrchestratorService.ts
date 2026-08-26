import type { OrchestrationExecution, Prisma } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { OrchestrationExecutionRepository } from '../../database/repositories/OrchestrationExecutionRepository';
import type {
  OrchestrationPlan,
  PlanPreview,
  OrchestrationRequest,
  OrchestrationResult,
  OrchestrationStepResult,
} from '../../domains/orchestration';
import { CapabilityNotFoundError, CapabilityRegistry } from './CapabilityRegistry';
import { composeOrchestrationResponse, consolidateEvidence } from './EvidenceConsolidator';
import { createOrchestrationPlan } from './IntentRouter';
import { createDefaultCapabilityRegistry } from './OrchestrationComposition';
import {
  PlanReviewConflictError,
  PlanReviewRequiredError,
  PlanReviewService,
  hashOrchestrationRequest,
} from './PlanReviewService';

export class OrchestrationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchestrationValidationError';
  }
}

export class OrchestrationNotFoundError extends Error {
  constructor() {
    super('Orchestration execution not found');
    this.name = 'OrchestrationNotFoundError';
  }
}

export class OrchestrationConfirmationRequiredError extends Error {
  constructor() {
    super('Explicit confirmation is required for external side effects');
    this.name = 'OrchestrationConfirmationRequiredError';
  }
}

const normalizeOptional = (value: string | null | undefined, field: string, max = 120): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new OrchestrationValidationError(`${field} must be a non-empty string up to ${max} characters`);
  }
  return value.trim();
};

const normalizeRequest = (input: OrchestrationRequest): OrchestrationRequest => {
  if (!input || typeof input !== 'object' || typeof input.intent !== 'string') {
    throw new OrchestrationValidationError('intent is required');
  }
  const intent = input.intent.trim();
  if (!intent || Array.from(intent).length > 1_000) {
    throw new OrchestrationValidationError('intent must contain from 1 to 1000 characters');
  }
  return {
    ...input,
    intent,
    projectId: normalizeOptional(input.projectId, 'projectId'),
    conversationId: normalizeOptional(input.conversationId, 'conversationId'),
    idempotencyKey: normalizeOptional(input.idempotencyKey, 'idempotencyKey') ?? undefined,
  };
};

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const isUniqueError = (error: unknown): boolean =>
  !!error && typeof error === 'object' && 'code' in error && error.code === 'P2002';

export class OrchestratorService {
  private executionRepository?: OrchestrationExecutionRepository;
  private readonly planReviewService?: PlanReviewService;
  private readonly active = new Map<string, {
    requestHash: string;
    operation: Promise<{
      execution: OrchestrationExecution;
      result: OrchestrationResult;
      created: boolean;
    }>;
  }>();

  constructor(
    private readonly registry: CapabilityRegistry = createDefaultCapabilityRegistry(),
    executionRepository?: OrchestrationExecutionRepository,
    planReviewService?: PlanReviewService,
  ) {
    this.executionRepository = executionRepository;
    this.planReviewService = planReviewService ?? (executionRepository ? undefined : new PlanReviewService());
  }

  private get executions(): OrchestrationExecutionRepository {
    if (!this.executionRepository) {
      this.executionRepository = new OrchestrationExecutionRepository(DatabaseService.client);
    }
    return this.executionRepository;
  }

  listCapabilities() {
    return this.registry.list();
  }

  private createPlan(request: OrchestrationRequest): OrchestrationPlan {
    const plan = createOrchestrationPlan(request);
    return {
      ...plan,
      steps: plan.steps.map((step) => ({
        ...step,
        objective: this.registry.get(step.capabilityId).definition.responsibility,
        sideEffect: this.registry.get(step.capabilityId).definition.sideEffect,
        persistentMutation: this.registry.get(step.capabilityId).definition.persistentMutation,
        maxAffectedItems: this.registry.get(step.capabilityId).definition.maxAffectedItems,
        inputs: [...this.registry.get(step.capabilityId).definition.inputs],
        outputs: [...this.registry.get(step.capabilityId).definition.outputs],
      })),
    };
  }

  plan(input: OrchestrationRequest): OrchestrationPlan {
    return this.createPlan(normalizeRequest(input));
  }

  async preview(input: OrchestrationRequest): Promise<PlanPreview> {
    if (!this.planReviewService) throw new PlanReviewConflictError('Plan review is not configured');
    const request = normalizeRequest(input);
    const plan = this.createPlan(request);
    if (plan.missingData.length > 0) {
      throw new OrchestrationValidationError(`missing required data: ${plan.missingData.join(', ')}`);
    }
    return this.planReviewService.preview(request, plan);
  }

  async run(input: OrchestrationRequest): Promise<{
    execution: OrchestrationExecution;
    result: OrchestrationResult;
    created: boolean;
  }> {
    const request = normalizeRequest(input);
    const activeKey = request.idempotencyKey;
    if (activeKey) {
      const running = this.active.get(activeKey);
      const requestHash = hashOrchestrationRequest(request);
      if (running) {
        if (running.requestHash !== requestHash) {
          throw new PlanReviewConflictError('Idempotency key is already bound to a different request');
        }
        return running.operation;
      }
      const operation = this.runNormalized(request).finally(() => this.active.delete(activeKey));
      this.active.set(activeKey, { requestHash, operation });
      return operation;
    }
    return this.runNormalized(request);
  }

  private async runNormalized(request: OrchestrationRequest): Promise<{
    execution: OrchestrationExecution;
    result: OrchestrationResult;
    created: boolean;
  }> {
    const plan = this.createPlan(request);
    if (plan.missingData.length > 0) {
      throw new OrchestrationValidationError(`missing required data: ${plan.missingData.join(', ')}`);
    }
    if (this.planReviewService) {
      const preview = await this.planReviewService.preview(request, plan);
      const execution = await this.getExecution(preview.executionId);
      if (execution.result) {
        return { execution, result: execution.result as unknown as OrchestrationResult, created: false };
      }
      if (preview.review.state !== 'approved') throw new PlanReviewRequiredError(preview.executionId);
      return this.executeApprovedPlan(preview.executionId, preview.created);
    }
    if (plan.hasExternalSideEffect && request.confirmExternalSideEffect !== true) {
      throw new OrchestrationConfirmationRequiredError();
    }
    if (request.idempotencyKey) {
      const existing = await this.executions.findByIdempotencyKey(request.idempotencyKey);
      if (existing?.result) {
        return { execution: existing, result: existing.result as unknown as OrchestrationResult, created: false };
      }
    }

    let execution: OrchestrationExecution;
    try {
      execution = await this.executions.create({
        projectId: request.projectId ?? null,
        conversationId: request.conversationId ?? null,
        idempotencyKey: request.idempotencyKey ?? null,
        intent: plan.intent,
        objective: plan.objective,
        capabilities: json(plan.capabilities),
        request: json(request),
        plan: json(plan),
        failures: [],
      });
    } catch (error) {
      if (request.idempotencyKey && isUniqueError(error)) {
        const existing = await this.executions.findByIdempotencyKey(request.idempotencyKey);
        if (existing?.result) {
          return { execution: existing, result: existing.result as unknown as OrchestrationResult, created: false };
        }
      }
      throw error;
    }
    await this.executions.markRunning(execution.id);

    return this.executeSteps(execution, request, plan, undefined, true);
  }

  private async executeSteps(
    execution: OrchestrationExecution,
    request: OrchestrationRequest,
    plan: OrchestrationPlan,
    approvedReview: Awaited<ReturnType<PlanReviewService['getReview']>> | undefined,
    created: boolean,
  ): Promise<{ execution: OrchestrationExecution; result: OrchestrationResult; created: boolean }> {

    const results = new Map<string, OrchestrationStepResult>();
    for (const step of plan.steps) {
      const blocked = step.dependencies.some((dependency) => results.get(dependency)?.status === 'failed');
      if (blocked) {
        results.set(step.id, {
          stepId: step.id, capabilityId: step.capabilityId, status: 'skipped', durationMs: 0,
          errorType: 'DependencyFailed',
        });
        continue;
      }
      if (step.condition) {
        const source = results.get(step.condition.stepId)?.output?.data?.[step.condition.dataField];
        const satisfied = step.condition.operator === 'greater_than'
          && typeof source === 'number'
          && source > step.condition.value;
        if (!satisfied) {
          results.set(step.id, {
            stepId: step.id, capabilityId: step.capabilityId, status: 'skipped', durationMs: 0,
          });
          continue;
        }
      }
      const startedAt = Date.now();
      try {
        const output = await this.registry.get(step.capabilityId).execute({ request, plan, results });
        results.set(step.id, {
          stepId: step.id,
          capabilityId: step.capabilityId,
          status: output.skipped ? 'skipped' : 'completed',
          durationMs: Math.max(0, Date.now() - startedAt),
          output,
        });
      } catch (error) {
        results.set(step.id, {
          stepId: step.id,
          capabilityId: step.capabilityId,
          status: 'failed',
          durationMs: Math.max(0, Date.now() - startedAt),
          errorType: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    }

    const steps = [...results.values()];
    const failures = steps.filter(({ status }) => status === 'failed');
    const completed = steps.filter(({ status }) => status === 'completed');
    const evidence = consolidateEvidence(steps);
    const plannerResponse = steps.find(({ capabilityId }) => capabilityId === 'planner.respond')?.output?.summary;
    const status = failures.length === 0 ? 'completed' : completed.length > 0 ? 'partial' : 'failed';
    const result: OrchestrationResult = {
      status,
      interpretation: plan.objective,
      response: plannerResponse ?? composeOrchestrationResponse(evidence),
      capabilities: plan.capabilities,
      steps,
      evidence,
    };
    execution = await this.executions.complete(execution.id, {
      status,
      result: json(result),
      evidence: json(evidence),
      failures: json(failures.map(({ stepId, capabilityId, errorType }) => ({ stepId, capabilityId, errorType }))),
      errorType: status === 'failed' ? 'OrchestrationFailed' : null,
    });
    if (approvedReview && this.planReviewService) {
      await this.planReviewService.markExecuted(execution.id, approvedReview);
    }
    return { execution, result, created };
  }

  async executeApprovedPlan(executionId: string, created = false): Promise<{
    execution: OrchestrationExecution;
    result: OrchestrationResult;
    created: boolean;
  }> {
    if (!this.planReviewService) throw new PlanReviewConflictError('Plan review is not configured');
    let execution = await this.getExecution(executionId);
    if (execution.result) {
      return { execution, result: execution.result as unknown as OrchestrationResult, created: false };
    }
    const request = normalizeRequest(execution.request as unknown as OrchestrationRequest);
    let plan: OrchestrationPlan;
    try {
      plan = this.createPlan(request);
    } catch (error) {
      if (error instanceof CapabilityNotFoundError) {
        return this.planReviewService.invalidateForCapabilityChange(execution.id);
      }
      throw error;
    }
    if (plan.missingData.length > 0) {
      await this.planReviewService.recordExecutionBlocked(
        execution.id,
        `Plan no longer has required data: ${plan.missingData.join(', ')}`,
      );
      throw new OrchestrationValidationError(`missing required data: ${plan.missingData.join(', ')}`);
    }
    const review = await this.planReviewService.assertExecutable(execution, plan);
    const claimed = await this.executions.tryMarkRunning(execution.id);
    if (!claimed) {
      execution = await this.getExecution(execution.id);
      if (execution.result) {
        return { execution, result: execution.result as unknown as OrchestrationResult, created: false };
      }
      await this.planReviewService.recordExecutionBlocked(execution.id, 'Execution is already running');
      throw new PlanReviewConflictError('Execution is already running');
    }
    execution = await this.getExecution(execution.id);
    return this.executeSteps(execution, request, plan, review, created);
  }

  async getPlanReview(id: string) {
    if (!this.planReviewService) throw new PlanReviewConflictError('Plan review is not configured');
    await this.getExecution(id);
    return this.planReviewService.getReview(id);
  }

  async approvePlan(id: string, reviewer: unknown, reason: unknown, expectedVersion: number) {
    if (!this.planReviewService) throw new PlanReviewConflictError('Plan review is not configured');
    await this.getExecution(id);
    return this.planReviewService.approve({ executionId: id, reviewer, reason, expectedVersion });
  }

  async rejectPlan(id: string, reviewer: unknown, reason: unknown, expectedVersion: number) {
    if (!this.planReviewService) throw new PlanReviewConflictError('Plan review is not configured');
    await this.getExecution(id);
    return this.planReviewService.reject({ executionId: id, reviewer, reason, expectedVersion });
  }

  async expirePlan(id: string, reason?: string) {
    if (!this.planReviewService) throw new PlanReviewConflictError('Plan review is not configured');
    await this.getExecution(id);
    return this.planReviewService.expire(id, reason);
  }

  async getAuditTrail(id: string) {
    if (!this.planReviewService) throw new PlanReviewConflictError('Plan review is not configured');
    await this.getExecution(id);
    return this.planReviewService.getAuditTrail(id);
  }

  async getExecution(id: string): Promise<OrchestrationExecution> {
    const normalized = normalizeOptional(id, 'executionId');
    const execution = normalized ? await this.executions.findById(normalized) : null;
    if (!execution) throw new OrchestrationNotFoundError();
    return execution;
  }

  async getExecutionPlan(id: string): Promise<unknown> {
    return (await this.getExecution(id)).plan;
  }

  async listRecent(filters: { projectId?: string | null; conversationId?: string | null; limit?: number } = {}) {
    const limit = filters.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new OrchestrationValidationError('limit must be an integer from 1 to 50');
    }
    return this.executions.findRecent({
      projectId: filters.projectId === undefined ? undefined : normalizeOptional(filters.projectId, 'projectId'),
      conversationId: filters.conversationId === undefined
        ? undefined : normalizeOptional(filters.conversationId, 'conversationId'),
      limit,
    });
  }
}
