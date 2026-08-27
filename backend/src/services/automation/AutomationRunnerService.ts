import type { Automation, AutomationRun, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../database/DatabaseService';
import { AutomationAuditRepository } from '../../database/repositories/AutomationAuditRepository';
import { AutomationRepository } from '../../database/repositories/AutomationRepository';
import { AutomationRunRepository } from '../../database/repositories/AutomationRunRepository';
import { calculateNextRunAt, type AutomationSchedule, type AutomationTriggerType } from '../../domains/automation';
import type { OrchestrationRequest, OrchestrationResult, PlanPreview } from '../../domains/orchestration';
import { OrchestratorService } from '../orchestration/OrchestratorService';
import { AutomationConflictError, AutomationNotFoundError, AutomationValidationError } from './AutomationService';

type AutomationOrchestrator = Pick<OrchestratorService, 'preview' | 'executeApprovedPlan'>;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const isUniqueError = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'P2002';
const safeReason = (error: unknown) => {
  const name = error instanceof Error ? error.name : 'UnknownError';
  if (name === 'AutomationRuntimeTransientError') return name;
  return ['OrchestrationValidationError', 'PlanReviewConflictError', 'PlanReviewRequiredError', 'PlanReviewRejectedError']
    .includes(name) ? name : 'AutomationExecutionFailed';
};
const summary = (result: OrchestrationResult) => `${result.status}: ${result.response ?? 'sem resumo'}`.slice(0, 500);

export class AutomationRunNotFoundError extends Error {
  constructor() { super('Automation run not found'); this.name = 'AutomationRunNotFoundError'; }
}

export class AutomationRunnerService {
  constructor(
    private readonly automations = new AutomationRepository(DatabaseService.client),
    private readonly runs = new AutomationRunRepository(DatabaseService.client),
    private readonly audits = new AutomationAuditRepository(DatabaseService.client),
    private readonly orchestrator: AutomationOrchestrator = new OrchestratorService(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async getAutomation(id: string) {
    if (typeof id !== 'string' || !id.trim()) throw new AutomationValidationError('automationId is required');
    const automation = await this.automations.findById(id.trim());
    if (!automation) throw new AutomationNotFoundError();
    if (!automation.intent) throw new AutomationValidationError('automation has no executable intent');
    return automation;
  }

  private requestFor(automation: Automation, occurrenceKey: string): OrchestrationRequest {
    const input = automation.orchestrationInput && typeof automation.orchestrationInput === 'object'
      ? automation.orchestrationInput as Omit<OrchestrationRequest, 'intent'> : {};
    const request = { ...input, intent: automation.intent as string,
      idempotencyKey: `automation:${automation.id}:${occurrenceKey}` } as OrchestrationRequest;
    if (request.sync?.mode === 'recent') {
      const end = this.now(); const start = new Date(end); start.setUTCDate(start.getUTCDate() - 7);
      request.sync = { ...request.sync, startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
    }
    return request;
  }

  private next(automation: Automation, after: Date) {
    return calculateNextRunAt(
      automation.triggerType as AutomationTriggerType,
      automation.schedule as AutomationSchedule,
      automation.timezone,
      after,
    );
  }

  private async claim(automation: Automation, triggerSource: 'MANUAL' | 'SCHEDULED', scheduledFor: Date | null) {
    const occurrenceKey = triggerSource === 'SCHEDULED'
      ? `SCHEDULED:${scheduledFor?.toISOString()}`
      : `MANUAL:${this.now().toISOString()}:${randomUUID()}`;
    try {
      const run = await this.runs.create({ automationId: automation.id, occurrenceKey, triggerSource, scheduledFor });
      return { run, created: true };
    } catch (error) {
      if (!isUniqueError(error)) throw error;
      const existing = await this.runs.findByOccurrence(automation.id, occurrenceKey)
        ?? await this.runs.findActive(automation.id);
      if (existing) return { run: existing, created: false };
      throw new AutomationConflictError('Automation already has an active run');
    }
  }

  private async audit(automationId: string, runId: string, eventType: string, reason?: string, details?: unknown) {
    await this.audits.append({ automationId, runId, eventType, reason,
      ...(details === undefined ? {} : { details: json(details) }) });
  }

  private async finish(
    automation: Automation,
    run: AutomationRun,
    result: OrchestrationResult,
    triggerSource: 'MANUAL' | 'SCHEDULED',
  ) {
    const at = this.now();
    const succeeded = result.status !== 'failed';
    const completed = await this.runs.update(run.id, {
      status: succeeded ? 'SUCCEEDED' : 'FAILED', resultSummary: summary(result),
      failureReason: succeeded ? null : 'OrchestrationFailed', completedAt: at,
    });
    const scheduled = triggerSource === 'SCHEDULED';
    await this.automations.update(automation.id, {
      lastRunAt: at,
      status: succeeded ? (automation.enabled ? 'ACTIVE' : automation.status) : 'ERROR',
      ...(scheduled ? { nextRunAt: this.next(automation, run.scheduledFor ?? at) } : {}),
    });
    await this.audit(automation.id, run.id, succeeded ? 'RUN_SUCCEEDED' : 'RUN_FAILED',
      succeeded ? undefined : 'OrchestrationFailed', { orchestrationStatus: result.status });
    return completed;
  }

  private async executeClaimed(automation: Automation, run: AutomationRun, triggerSource: 'MANUAL' | 'SCHEDULED') {
    await this.runs.update(run.id, { status: 'RUNNING', startedAt: this.now() });
    await this.audit(automation.id, run.id, 'RUN_STARTED', undefined, { triggerSource });
    try {
      const preview: PlanPreview = await this.orchestrator.preview(this.requestFor(automation, run.occurrenceKey));
      await this.runs.update(run.id, { orchestrationExecutionId: preview.executionId });
      await this.automations.update(automation.id, {
        riskLevel: preview.review.riskLevel, sideEffectLevel: preview.review.sideEffectLevel,
      });
      if (preview.review.state !== 'approved') {
        const at = this.now();
        const blocked = await this.runs.update(run.id, {
          status: 'BLOCKED', orchestrationExecutionId: preview.executionId,
          failureReason: 'PlanReviewRequired', completedAt: at,
        });
        await this.automations.update(automation.id, {
          status: 'BLOCKED', lastRunAt: at,
          ...(triggerSource === 'SCHEDULED' ? { nextRunAt: this.next(automation, run.scheduledFor ?? at) } : {}),
        });
        await this.audit(automation.id, run.id, 'RUN_BLOCKED', 'PlanReviewRequired', {
          executionId: preview.executionId, riskLevel: preview.review.riskLevel,
          sideEffectLevel: preview.review.sideEffectLevel,
        });
        return { run: blocked, created: true, review: preview.review };
      }
      const execution = await this.orchestrator.executeApprovedPlan(preview.executionId, preview.created);
      return { run: await this.finish(automation, { ...run, orchestrationExecutionId: preview.executionId }, execution.result, triggerSource), created: true, result: execution.result };
    } catch (error) {
      const reason = safeReason(error);
      const at = this.now();
      const failed = await this.runs.update(run.id, { status: 'FAILED', failureReason: reason, completedAt: at });
      await this.automations.update(automation.id, {
        status: 'ERROR', lastRunAt: at,
        ...(triggerSource === 'SCHEDULED' ? { nextRunAt: this.next(automation, run.scheduledFor ?? at) } : {}),
      });
      await this.audit(automation.id, run.id, 'RUN_FAILED', reason);
      return { run: failed, created: true };
    }
  }

  async runNow(automationId: string) {
    const automation = await this.getAutomation(automationId);
    if (automation.status === 'BLOCKED') {
      const blocked = await this.runs.findAwaitingReview(automation.id);
      if (blocked) return { run: blocked, created: false };
    }
    const claim = await this.claim(automation, 'MANUAL', null);
    if (!claim.created) return { ...claim };
    return this.executeClaimed(automation, claim.run, 'MANUAL');
  }

  async runScheduled(automationId: string, scheduledFor: Date) {
    const automation = await this.getAutomation(automationId);
    if (!automation.enabled || automation.status !== 'ACTIVE') {
      throw new AutomationConflictError('Automation is not active');
    }
    const claim = await this.claim(automation, 'SCHEDULED', scheduledFor);
    if (!claim.created) return { ...claim };
    await this.audit(automation.id, claim.run.id, 'RUN_DUE', undefined, { scheduledFor: scheduledFor.toISOString() });
    return this.executeClaimed(automation, claim.run, 'SCHEDULED');
  }

  async executeApprovedRun(runId: string) {
    const run = await this.runs.findById(runId);
    if (!run) throw new AutomationRunNotFoundError();
    if (run.status !== 'BLOCKED' || !run.orchestrationExecutionId) {
      throw new AutomationConflictError('Automation run is not awaiting an approved plan');
    }
    let claimed = false;
    try { claimed = await this.runs.tryResumeBlocked(run.id); } catch (error) {
      if (!isUniqueError(error)) throw error;
    }
    if (!claimed) throw new AutomationConflictError('Automation run is already being executed');
    const automation = await this.getAutomation(run.automationId);
    try {
      const execution = await this.orchestrator.executeApprovedPlan(run.orchestrationExecutionId);
      return { run: await this.finish(automation, run, execution.result, run.triggerSource as 'MANUAL' | 'SCHEDULED'), result: execution.result };
    } catch (error) {
      await this.runs.update(run.id, { status: 'BLOCKED', completedAt: this.now() });
      if (safeReason(error) === 'AutomationExecutionFailed') throw error;
      throw new AutomationConflictError('Automation plan is not approved for execution');
    }
  }

  async getRun(id: string) {
    if (typeof id !== 'string' || !id.trim()) throw new AutomationValidationError('runId is required');
    const run = await this.runs.findById(id.trim());
    if (!run) throw new AutomationRunNotFoundError();
    return run;
  }

  async retryTechnicalRun(runId: string, maxRetries: number) {
    const run = await this.getRun(runId);
    const maxAttempts = Math.max(1, maxRetries + 1);
    if (!await this.runs.tryRetryTechnical(run.id, maxAttempts)) return { run, created: false };
    const updated = await this.getRun(run.id);
    const automation = await this.getAutomation(updated.automationId);
    await this.audit(automation.id, updated.id, 'RUN_RETRIED', 'AutomationRuntimeTransientError', { attempt: updated.attempt });
    return this.executeClaimed(automation, updated, updated.triggerSource as 'MANUAL' | 'SCHEDULED');
  }
}
