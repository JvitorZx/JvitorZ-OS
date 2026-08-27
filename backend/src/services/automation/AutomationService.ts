import { Prisma, type Automation } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { AutomationAuditRepository } from '../../database/repositories/AutomationAuditRepository';
import { AutomationRepository } from '../../database/repositories/AutomationRepository';
import { AutomationRunRepository } from '../../database/repositories/AutomationRunRepository';
import {
  AUTOMATION_TRIGGER_TYPES,
  calculateNextRunAt,
  assertTimeZone,
  normalizeAutomationSchedule,
  type AutomationOrchestrationInput,
  type AutomationSchedule,
  type AutomationTriggerType,
  type CreateAutomationInput,
  type UpdateAutomationInput,
} from '../../domains/automation';
import { OrchestratorService } from '../orchestration/OrchestratorService';
import { classifyPlanRisk } from '../orchestration/PlanRiskClassifier';

export class AutomationValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'AutomationValidationError'; }
}
export class AutomationNotFoundError extends Error {
  constructor() { super('Automation not found'); this.name = 'AutomationNotFoundError'; }
}
export class AutomationConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'AutomationConflictError'; }
}

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const text = (value: unknown, field: string, max: number, optional = false): string | null => {
  if ((value === undefined || value === null) && optional) return null;
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > max) {
    throw new AutomationValidationError(`${field} must be a non-empty string up to ${max} characters`);
  }
  return value.trim();
};

const normalizeInput = (value: unknown): AutomationOrchestrationInput => {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AutomationValidationError('orchestrationInput must be an object');
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['projectId', 'conversationId', 'sync'].includes(key))) {
    throw new AutomationValidationError('orchestrationInput contains unsupported fields');
  }
  for (const key of ['projectId', 'conversationId']) {
    if (input[key] !== undefined && input[key] !== null && (typeof input[key] !== 'string' || !input[key].trim())) {
      throw new AutomationValidationError(`${key} must be a non-empty string`);
    }
  }
  if (input.sync !== undefined) {
    if (!input.sync || typeof input.sync !== 'object' || Array.isArray(input.sync)) {
      throw new AutomationValidationError('sync must be an object');
    }
    const sync = input.sync as Record<string, unknown>;
    if (Object.keys(sync).some((key) => !['mode', 'startDate', 'endDate', 'videoId', 'limit'].includes(key))
      || !['video', 'recent', 'period'].includes(String(sync.mode))
      || typeof sync.startDate !== 'string' || typeof sync.endDate !== 'string'
      || (sync.videoId !== undefined && typeof sync.videoId !== 'string')
      || (sync.limit !== undefined && (!Number.isInteger(sync.limit) || Number(sync.limit) < 1 || Number(sync.limit) > 50))) {
      throw new AutomationValidationError('sync configuration is invalid');
    }
  }
  return structuredClone(value) as AutomationOrchestrationInput;
};

const trigger = (value: unknown): AutomationTriggerType => {
  if (typeof value !== 'string' || !AUTOMATION_TRIGGER_TYPES.includes(value as AutomationTriggerType)) {
    throw new AutomationValidationError('triggerType must be MANUAL_ONLY, DAILY or WEEKLY');
  }
  return value as AutomationTriggerType;
};

export class AutomationService {
  constructor(
    private readonly repository = new AutomationRepository(DatabaseService.client),
    private readonly runs = new AutomationRunRepository(DatabaseService.client),
    private readonly audits = new AutomationAuditRepository(DatabaseService.client),
    private readonly orchestrator: Pick<OrchestratorService, 'plan'> = new OrchestratorService(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  private assess(intent: string, orchestrationInput: AutomationOrchestrationInput) {
    const plan = this.orchestrator.plan({ ...orchestrationInput, intent });
    if (plan.missingData.length) {
      throw new AutomationValidationError(`missing required data: ${plan.missingData.join(', ')}`);
    }
    return classifyPlanRisk(plan);
  }

  async create(input: CreateAutomationInput): Promise<Automation> {
    if (!input || typeof input !== 'object') throw new AutomationValidationError('automation payload is required');
    const name = text(input.name, 'name', 120) as string;
    const intent = text(input.intent, 'intent', 1_000) as string;
    const triggerType = trigger(input.triggerType);
    const timezone = assertTimeZone(input.timezone ?? 'UTC');
    const schedule = normalizeAutomationSchedule(triggerType, input.schedule);
    const orchestrationInput = normalizeInput(input.orchestrationInput);
    const assessment = this.assess(intent, orchestrationInput);
    const enabled = input.enabled === true;
    const at = this.now();
    const created = await this.repository.create({
      projectId: input.projectId ?? null,
      name,
      description: input.description === undefined || input.description === null
        ? null : text(input.description, 'description', 500, true),
      trigger: triggerType,
      action: intent,
      triggerType,
      schedule: schedule ? json(schedule) : undefined,
      timezone,
      intent,
      orchestrationInput: json(orchestrationInput),
      status: enabled ? 'ACTIVE' : 'DISABLED',
      riskLevel: assessment.riskLevel,
      sideEffectLevel: assessment.sideEffectLevel,
      enabled,
      nextRunAt: enabled ? calculateNextRunAt(triggerType, schedule, timezone, at) : null,
    });
    await this.audits.append({ automationId: created.id, eventType: 'AUTOMATION_CREATED',
      details: json({ triggerType, enabled, riskLevel: assessment.riskLevel, sideEffectLevel: assessment.sideEffectLevel }) });
    return created;
  }

  list(): Promise<Automation[]> { return this.repository.findAll(); }

  async getById(id: string): Promise<Automation> {
    const normalized = text(id, 'automationId', 120) as string;
    const automation = await this.repository.findById(normalized);
    if (!automation) throw new AutomationNotFoundError();
    return automation;
  }

  async update(id: string, input: UpdateAutomationInput): Promise<Automation> {
    const current = await this.getById(id);
    if (!input || typeof input !== 'object') throw new AutomationValidationError('automation payload is required');
    const triggerType = input.triggerType === undefined ? trigger(current.triggerType) : trigger(input.triggerType);
    const timezone = input.timezone === undefined ? current.timezone : assertTimeZone(input.timezone);
    const currentSchedule = current.schedule as AutomationSchedule;
    const schedule = normalizeAutomationSchedule(triggerType, input.schedule === undefined ? currentSchedule : input.schedule);
    const intent = input.intent === undefined ? (current.intent ?? current.action ?? '') : text(input.intent, 'intent', 1_000) as string;
    const orchestrationInput = input.orchestrationInput === undefined
      ? normalizeInput(current.orchestrationInput ?? {}) : normalizeInput(input.orchestrationInput);
    const assessment = this.assess(intent, orchestrationInput);
    const updated = await this.repository.update(current.id, {
      ...(input.name !== undefined ? { name: text(input.name, 'name', 120) as string } : {}),
      ...(input.description !== undefined ? { description: input.description === null ? null : text(input.description, 'description', 500, true) } : {}),
      triggerType, trigger: triggerType, schedule: schedule ? json(schedule) : Prisma.DbNull, timezone,
      intent, action: intent, orchestrationInput: json(orchestrationInput),
      riskLevel: assessment.riskLevel, sideEffectLevel: assessment.sideEffectLevel,
      ...(current.enabled && current.status === 'ACTIVE'
        ? { nextRunAt: calculateNextRunAt(triggerType, schedule, timezone, this.now()) } : {}),
    });
    await this.audits.append({ automationId: current.id, eventType: 'AUTOMATION_UPDATED' });
    return updated;
  }

  private async transition(id: string, status: 'ACTIVE' | 'DISABLED' | 'PAUSED', enabled: boolean, eventType: string) {
    const current = await this.getById(id);
    const schedule = normalizeAutomationSchedule(trigger(current.triggerType), current.schedule as AutomationSchedule);
    const updated = await this.repository.update(current.id, {
      status, enabled,
      nextRunAt: status === 'ACTIVE'
        ? calculateNextRunAt(trigger(current.triggerType), schedule, current.timezone, this.now()) : null,
    });
    await this.audits.append({ automationId: current.id, eventType });
    return updated;
  }

  enable(id: string) { return this.transition(id, 'ACTIVE', true, 'AUTOMATION_ENABLED'); }
  disable(id: string) { return this.transition(id, 'DISABLED', false, 'AUTOMATION_DISABLED'); }
  pause(id: string) { return this.transition(id, 'PAUSED', true, 'AUTOMATION_PAUSED'); }
  resume(id: string) { return this.transition(id, 'ACTIVE', true, 'AUTOMATION_RESUMED'); }
  listRuns(id: string, limit = 50) { return this.getById(id).then(() => this.runs.listByAutomation(id, limit)); }
  listAudit(id: string, limit = 100) { return this.getById(id).then(() => this.audits.listByAutomation(id, limit)); }
  getOperationalSummary(now = this.now()) { return this.repository.getOperationalSummary(now); }
}
