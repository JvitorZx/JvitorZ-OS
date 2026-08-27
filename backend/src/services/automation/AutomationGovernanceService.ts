import { Prisma, type Automation } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { AutomationAuditRepository } from '../../database/repositories/AutomationAuditRepository';
import { AutomationGovernanceRepository } from '../../database/repositories/AutomationGovernanceRepository';
import { AutomationRepository } from '../../database/repositories/AutomationRepository';
import { AutomationRunRepository } from '../../database/repositories/AutomationRunRepository';
import {
  DEFAULT_AUTOMATION_GOVERNANCE,
  getZonedDateParts,
  zonedLocalToUtc,
  type AutomationGovernanceInput,
  type ExecutionWindow,
  type GovernanceDecision,
  type GovernanceOverride,
} from '../../domains/automation';
import { AutomationConflictError, AutomationNotFoundError, AutomationValidationError } from './AutomationService';

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const integer = (value: unknown, field: string, min: number, max: number, nullable = true): number | null => {
  if (value === undefined || value === null) { if (nullable) return null; throw new AutomationValidationError(`${field} is required`); }
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new AutomationValidationError(`${field} must be an integer from ${min} to ${max}`);
  return Number(value);
};
const minutes = (value: string) => { const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute; };
const localWeekday = (parts: { year: number; month: number; day: number }) => new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
const shiftLocalDate = (parts: { year: number; month: number; day: number }, offset: number) => {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)); date.setUTCDate(date.getUTCDate() + offset);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
};

const normalizeWindows = (value: unknown): ExecutionWindow[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 14) throw new AutomationValidationError('allowedExecutionWindows must contain at most 14 windows');
  return value.map((window) => {
    if (!window || typeof window !== 'object' || Array.isArray(window)) throw new AutomationValidationError('execution window is invalid');
    const input = window as Record<string, unknown>;
    if (Object.keys(input).some((key) => !['start', 'end', 'weekdays'].includes(key))
      || typeof input.start !== 'string' || !TIME.test(input.start) || typeof input.end !== 'string' || !TIME.test(input.end)) {
      throw new AutomationValidationError('execution window must use start/end HH:mm');
    }
    if (input.weekdays !== undefined && (!Array.isArray(input.weekdays) || input.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) {
      throw new AutomationValidationError('execution window weekdays must use integers from 0 to 6');
    }
    return { start: input.start, end: input.end, ...(input.weekdays ? { weekdays: [...new Set(input.weekdays as number[])] } : {}) };
  });
};

export class AutomationGovernanceService {
  private static locks = new Map<string, Promise<void>>();
  constructor(
    private readonly policies = new AutomationGovernanceRepository(DatabaseService.client),
    private readonly automations = new AutomationRepository(DatabaseService.client),
    private readonly runs = new AutomationRunRepository(DatabaseService.client),
    private readonly audits = new AutomationAuditRepository(DatabaseService.client),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async withAutomationLock<T>(automationId: string, operation: () => Promise<T>): Promise<T> {
    const previous = AutomationGovernanceService.locks.get(automationId) ?? Promise.resolve(); let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current); AutomationGovernanceService.locks.set(automationId, tail); await previous;
    try { return await operation(); } finally { release(); if (AutomationGovernanceService.locks.get(automationId) === tail) AutomationGovernanceService.locks.delete(automationId); }
  }

  private async automation(id: string) {
    if (typeof id !== 'string' || !id.trim()) throw new AutomationValidationError('automationId is required');
    const automation = await this.automations.findById(id.trim()); if (!automation) throw new AutomationNotFoundError(); return automation;
  }

  async getPolicy(automationId: string) {
    await this.automation(automationId); const stored = await this.policies.findByAutomationId(automationId);
    return { automationId, enabled: stored?.enabled ?? DEFAULT_AUTOMATION_GOVERNANCE.enabled,
      maxRunsPerDay: stored?.maxRunsPerDay ?? DEFAULT_AUTOMATION_GOVERNANCE.maxRunsPerDay,
      maxRunsPerWeek: stored?.maxRunsPerWeek ?? DEFAULT_AUTOMATION_GOVERNANCE.maxRunsPerWeek,
      cooldownMinutes: stored?.cooldownMinutes ?? DEFAULT_AUTOMATION_GOVERNANCE.cooldownMinutes,
      allowedExecutionWindows: stored?.allowedExecutionWindows ? structuredClone(stored.allowedExecutionWindows) as unknown as ExecutionWindow[] : [],
      maxConsecutiveFailures: stored?.maxConsecutiveFailures ?? DEFAULT_AUTOMATION_GOVERNANCE.maxConsecutiveFailures,
      pauseOnRepeatedFailure: stored?.pauseOnRepeatedFailure ?? DEFAULT_AUTOMATION_GOVERNANCE.pauseOnRepeatedFailure,
      manualApprovalRequired: stored?.manualApprovalRequired ?? DEFAULT_AUTOMATION_GOVERNANCE.manualApprovalRequired,
      retryPolicy: stored?.retryPolicy ? structuredClone(stored.retryPolicy) as { maxRetries: number } : { maxRetries: 0 },
      createdAt: stored?.createdAt ?? null, updatedAt: stored?.updatedAt ?? null };
  }

  async updatePolicy(automationId: string, input: AutomationGovernanceInput) {
    await this.automation(automationId);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AutomationValidationError('governance payload is required');
    const allowed = ['enabled', 'maxRunsPerDay', 'maxRunsPerWeek', 'cooldownMinutes', 'allowedExecutionWindows', 'maxConsecutiveFailures', 'pauseOnRepeatedFailure', 'manualApprovalRequired', 'retryPolicy'];
    if (!Object.keys(input).length || Object.keys(input).some((key) => !allowed.includes(key))) throw new AutomationValidationError('governance payload contains unsupported fields');
    const current = await this.getPolicy(automationId); const retry = input.retryPolicy === undefined ? current.retryPolicy : input.retryPolicy;
    if (retry !== null && (!retry || typeof retry !== 'object' || Object.keys(retry).some((key) => key !== 'maxRetries'))) throw new AutomationValidationError('retryPolicy is invalid');
    const data = {
      enabled: input.enabled ?? current.enabled,
      maxRunsPerDay: input.maxRunsPerDay === undefined ? current.maxRunsPerDay : integer(input.maxRunsPerDay, 'maxRunsPerDay', 1, 100),
      maxRunsPerWeek: input.maxRunsPerWeek === undefined ? current.maxRunsPerWeek : integer(input.maxRunsPerWeek, 'maxRunsPerWeek', 1, 500),
      cooldownMinutes: input.cooldownMinutes === undefined ? current.cooldownMinutes : integer(input.cooldownMinutes, 'cooldownMinutes', 0, 10_080),
      allowedExecutionWindows: json(input.allowedExecutionWindows === undefined ? current.allowedExecutionWindows : normalizeWindows(input.allowedExecutionWindows)),
      maxConsecutiveFailures: input.maxConsecutiveFailures === undefined ? current.maxConsecutiveFailures : integer(input.maxConsecutiveFailures, 'maxConsecutiveFailures', 1, 20),
      pauseOnRepeatedFailure: input.pauseOnRepeatedFailure ?? current.pauseOnRepeatedFailure,
      manualApprovalRequired: input.manualApprovalRequired ?? current.manualApprovalRequired,
      retryPolicy: json(retry === null ? { maxRetries: 0 } : { maxRetries: integer(retry.maxRetries, 'retryPolicy.maxRetries', 0, 2, false) }),
    };
    for (const field of ['enabled', 'pauseOnRepeatedFailure', 'manualApprovalRequired'] as const) if (typeof data[field] !== 'boolean') throw new AutomationValidationError(`${field} must be boolean`);
    const saved = await this.policies.upsert(automationId, data); await this.audits.append({ automationId, eventType: 'GOVERNANCE_UPDATED' }); return saved;
  }

  private period(automation: Automation, at: Date) {
    const parts = getZonedDateParts(at, automation.timezone); const weekday = localWeekday(parts);
    const dayStart = zonedLocalToUtc({ ...parts, hour: 0, minute: 0 }, automation.timezone);
    const nextDay = shiftLocalDate(parts, 1); const dayEnd = zonedLocalToUtc({ ...nextDay, hour: 0, minute: 0 }, automation.timezone);
    const mondayOffset = (weekday + 6) % 7; const weekLocal = shiftLocalDate(parts, -mondayOffset);
    const weekStart = zonedLocalToUtc({ ...weekLocal, hour: 0, minute: 0 }, automation.timezone);
    const nextWeek = shiftLocalDate(weekLocal, 7); const weekEnd = zonedLocalToUtc({ ...nextWeek, hour: 0, minute: 0 }, automation.timezone);
    return { dayStart, dayEnd, weekStart, weekEnd };
  }

  private windowState(windows: ExecutionWindow[], timezone: string, at: Date) {
    if (!windows.length) return { allowed: true, next: null as Date | null };
    const parts = getZonedDateParts(at, timezone); const currentMinute = parts.hour * 60 + parts.minute; const day = localWeekday(parts);
    const allowed = windows.some((window) => { const start = minutes(window.start); const end = minutes(window.end);
      const anchorDay = start <= end || currentMinute >= start ? day : (day + 6) % 7;
      const weekdayAllowed = !window.weekdays?.length || window.weekdays.includes(anchorDay);
      return weekdayAllowed && (start <= end ? currentMinute >= start && currentMinute < end : currentMinute >= start || currentMinute < end); });
    if (allowed) return { allowed: true, next: null as Date | null };
    let next: Date | null = null;
    for (let offset = 0; offset <= 7; offset += 1) { const local = shiftLocalDate(parts, offset); const candidateDay = localWeekday(local);
      for (const window of windows) { if (window.weekdays?.length && !window.weekdays.includes(candidateDay)) continue;
        const [hour, minute] = window.start.split(':').map(Number); const candidate = zonedLocalToUtc({ ...local, hour, minute }, timezone);
        if (candidate > at && (!next || candidate < next)) next = candidate;
      } }
    return { allowed: false, next };
  }

  async getUsage(automationId: string, at = this.now()) {
    const automation = await this.automation(automationId); const policy = await this.getPolicy(automationId); const period = this.period(automation, at);
    const [daily, weekly, latest, failures] = await Promise.all([this.runs.countRelevantSince(automationId, period.dayStart),
      this.runs.countRelevantSince(automationId, period.weekStart), this.runs.findLatestRelevant(automationId), this.runs.countConsecutiveFailures(automationId)]);
    return { automation, policy, period, daily, weekly, latest, failures };
  }

  async evaluate(automationId: string, triggerSource: 'MANUAL' | 'SCHEDULED' | 'RECOVERY', at = this.now(), override?: GovernanceOverride, record = true): Promise<GovernanceDecision> {
    const { automation, policy, period, daily, weekly, latest, failures } = await this.getUsage(automationId, at);
    const ignored = new Set(override?.policies ?? []); const reasons: string[] = []; const blockedPolicies: string[] = []; const deferred: Date[] = [];
    let decision: GovernanceDecision['decision'] = 'ALLOW';
    if (!automation.enabled || automation.status === 'DISABLED' || !policy.enabled) { decision = 'BLOCK'; reasons.push('Automation or governance is disabled'); blockedPolicies.push('enabled'); }
    else if (automation.status === 'BLOCKED' || (triggerSource !== 'RECOVERY' && ['PAUSED', 'ERROR'].includes(automation.status))) {
      decision = 'BLOCK'; reasons.push(`Automation status is ${automation.status}`); blockedPolicies.push('status');
    }
    else if (policy.manualApprovalRequired && triggerSource === 'SCHEDULED') { decision = 'REQUIRE_APPROVAL'; reasons.push('Scheduled execution requires manual approval'); blockedPolicies.push('manualApprovalRequired'); }
    if (decision === 'ALLOW' && triggerSource !== 'RECOVERY' && failures >= policy.maxConsecutiveFailures) { decision = 'BLOCK'; reasons.push('Consecutive failure threshold reached'); blockedPolicies.push('failureThreshold'); }
    if (decision === 'ALLOW' && !ignored.has('quota')) {
      if (daily >= policy.maxRunsPerDay) { decision = 'DEFER'; reasons.push('Daily quota reached'); blockedPolicies.push('dailyQuota'); deferred.push(period.dayEnd); }
      if (weekly >= policy.maxRunsPerWeek) { decision = 'DEFER'; reasons.push('Weekly quota reached'); blockedPolicies.push('weeklyQuota'); deferred.push(period.weekEnd); }
    }
    if (decision === 'ALLOW' && !ignored.has('window')) { const window = this.windowState(policy.allowedExecutionWindows, automation.timezone, at);
      if (!window.allowed) { decision = 'DEFER'; reasons.push('Outside allowed execution window'); blockedPolicies.push('executionWindow'); if (window.next) deferred.push(window.next); } }
    if (decision === 'ALLOW' && !ignored.has('cooldown') && policy.cooldownMinutes > 0 && latest?.completedAt) {
      const eligible = new Date(latest.completedAt.getTime() + policy.cooldownMinutes * 60_000);
      if (eligible > at) { decision = 'DEFER'; reasons.push('Cooldown is active'); blockedPolicies.push('cooldown'); deferred.push(eligible); }
    }
    const nextEligibleAt = deferred.length ? new Date(Math.max(...deferred.map(Number))) : null;
    const output = { decision, reasons, blockedPolicies, nextEligibleAt, facts: [`Daily usage ${daily}/${policy.maxRunsPerDay}`, `Weekly usage ${weekly}/${policy.maxRunsPerWeek}`, `Consecutive failures ${failures}/${policy.maxConsecutiveFailures}`] };
    if (record && decision !== 'ALLOW') { const eventType = blockedPolicies.includes('dailyQuota') || blockedPolicies.includes('weeklyQuota') ? 'QUOTA_REACHED'
      : blockedPolicies.includes('executionWindow') ? 'EXECUTION_WINDOW_BLOCKED' : blockedPolicies.includes('cooldown') ? 'COOLDOWN_ACTIVE' : 'GOVERNANCE_BLOCKED';
      await this.audits.append({ automationId, eventType, reason: blockedPolicies.join(','), details: json({ decision, nextEligibleAt }) });
      if (decision === 'DEFER' && nextEligibleAt) await this.automations.update(automationId, { nextRunAt: nextEligibleAt });
      if (decision === 'REQUIRE_APPROVAL') await this.automations.update(automationId, { status: 'BLOCKED' });
    }
    return output;
  }

  async recordOverride(automationId: string, override: GovernanceOverride) {
    if (!override || !Array.isArray(override.policies) || !override.policies.length || override.policies.some((item) => !['quota', 'window', 'cooldown'].includes(item))) throw new AutomationValidationError('override policies are invalid');
    if (typeof override.reason !== 'string' || !override.reason.trim() || override.reason.length > 300) throw new AutomationValidationError('override reason is required');
    if (typeof override.authorizedBy !== 'string' || !override.authorizedBy.trim() || override.authorizedBy.length > 120) throw new AutomationValidationError('override authorizedBy is required');
    await this.automation(automationId); await this.audits.append({ automationId, eventType: 'MANUAL_OVERRIDE', reason: override.reason.trim(),
      details: json({ authorizedBy: override.authorizedBy.trim(), policies: [...new Set(override.policies)], authorizedAt: this.now().toISOString() }) });
  }

  async applyFailurePolicy(automationId: string) {
    const { automation, policy, failures } = await this.getUsage(automationId);
    if (failures < policy.maxConsecutiveFailures) return { paused: false, failures };
    if (policy.pauseOnRepeatedFailure) await this.automations.update(automation.id, { status: 'PAUSED', nextRunAt: null });
    await this.audits.append({ automationId, eventType: 'FAILURE_THRESHOLD_REACHED', reason: 'ConsecutiveFailures', details: json({ failures, paused: policy.pauseOnRepeatedFailure }) });
    return { paused: policy.pauseOnRepeatedFailure, failures };
  }

  async clearBlock(automationId: string) {
    return this.withAutomationLock(automationId, async () => {
      const automation = await this.automation(automationId); const status = automation.enabled ? 'ACTIVE' : 'DISABLED';
      if (await this.runs.findAwaitingReview(automationId)) throw new AutomationConflictError('Pending PlanReview must be resolved before clearing the block');
      const updated = await this.automations.update(automationId, { status }); await this.audits.append({ automationId, eventType: 'BLOCK_CLEARED' }); return updated;
    });
  }
}
