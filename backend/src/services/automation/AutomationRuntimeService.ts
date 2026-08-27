import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { AutomationAuditRepository } from '../../database/repositories/AutomationAuditRepository';
import { AutomationRepository } from '../../database/repositories/AutomationRepository';
import { AutomationRunRepository } from '../../database/repositories/AutomationRunRepository';
import { AutomationRuntimeEventRepository } from '../../database/repositories/AutomationRuntimeEventRepository';
import { AutomationSchedulerService } from './AutomationSchedulerService';

export type AutomationRuntimeStatus = 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'ERROR';
export class AutomationRuntimeDisabledError extends Error {
  constructor() { super('Automation runtime is disabled by configuration'); this.name = 'AutomationRuntimeDisabledError'; }
}
export class AutomationRuntimeConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'AutomationRuntimeConflictError'; }
}

export interface AutomationRuntimeConfig {
  enabled: boolean;
  pollIntervalMs: number;
  maxRetries: number;
}
type TickResult = Awaited<ReturnType<AutomationSchedulerService['runDueAutomations']>>;
type TimerHandle = ReturnType<typeof setTimeout>;

export const readAutomationRuntimeConfig = (): AutomationRuntimeConfig => {
  const rawInterval = Number(process.env.AUTOMATION_POLL_INTERVAL_MS ?? 60_000);
  const rawRetries = Number(process.env.AUTOMATION_MAX_RETRIES ?? 0);
  return {
    enabled: process.env.AUTOMATION_RUNTIME_ENABLED?.trim().toLowerCase() === 'true',
    pollIntervalMs: Number.isFinite(rawInterval) ? Math.min(86_400_000, Math.max(5_000, Math.trunc(rawInterval))) : 60_000,
    maxRetries: Number.isInteger(rawRetries) ? Math.min(2, Math.max(0, rawRetries)) : 0,
  };
};

const safeName = (error: unknown) => error instanceof Error ? error.name : 'UnknownError';

export class AutomationRuntimeService {
  private static owner: AutomationRuntimeService | null = null;
  private status: AutomationRuntimeStatus = 'STOPPED';
  private startedAt: Date | null = null;
  private lastTickAt: Date | null = null;
  private lastSuccessfulTickAt: Date | null = null;
  private lastError: string | null = null;
  private dueCount = 0;
  private runsStarted = 0;
  private runsFailed = 0;
  private nextTickAt: Date | null = null;
  private timer: TimerHandle | null = null;
  private tickPromise: Promise<TickResult> | null = null;
  private activeConfig: AutomationRuntimeConfig | null = null;
  private scheduler: AutomationSchedulerService | undefined;

  constructor(
    scheduler: AutomationSchedulerService | undefined = undefined,
    private readonly runs = new AutomationRunRepository(DatabaseService.client),
    private readonly automations = new AutomationRepository(DatabaseService.client),
    private readonly audits = new AutomationAuditRepository(DatabaseService.client),
    private readonly events = new AutomationRuntimeEventRepository(DatabaseService.client),
    private readonly config: () => AutomationRuntimeConfig = readAutomationRuntimeConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly timers = { set: (handler: () => void, delay: number) => setTimeout(handler, delay), clear: (handle: TimerHandle) => clearTimeout(handle) },
  ) { this.scheduler = scheduler; }

  getHealth() {
    const configured = this.activeConfig ?? this.config();
    return { status: this.status, enabled: configured.enabled, pollIntervalMs: configured.pollIntervalMs,
      maxRetries: configured.maxRetries, startedAt: this.startedAt, lastTickAt: this.lastTickAt,
      lastSuccessfulTickAt: this.lastSuccessfulTickAt, lastError: this.lastError, dueCount: this.dueCount,
      runsStarted: this.runsStarted, runsFailed: this.runsFailed, nextTickAt: this.nextTickAt };
  }

  private async event(eventType: string, details?: Record<string, unknown>) {
    await this.events.append({ eventType, status: this.status,
      ...(details ? { details: JSON.parse(JSON.stringify(details)) as Prisma.InputJsonValue } : {}) });
  }

  async recoverInterruptedRuns() {
    const interrupted = await this.runs.findInterrupted();
    const at = this.now();
    for (const run of interrupted) {
      await this.runs.markInterrupted(run.id, at);
      await this.automations.update(run.automationId, { status: 'ERROR', lastRunAt: at });
      await this.audits.append({ automationId: run.automationId, runId: run.id,
        eventType: 'RUN_INTERRUPTED', reason: 'ProcessRestart' });
      await this.event('RUN_INTERRUPTED', { automationId: run.automationId, runId: run.id });
      await this.event('RUN_RECOVERED', { automationId: run.automationId, runId: run.id, action: 'marked_failed' });
    }
    return interrupted.length;
  }

  async start() {
    if (this.status === 'RUNNING' || this.status === 'STARTING') return this.getHealth();
    const config = this.config();
    if (!config.enabled) throw new AutomationRuntimeDisabledError();
    if (AutomationRuntimeService.owner && AutomationRuntimeService.owner !== this) {
      throw new AutomationRuntimeConflictError('Another automation runtime is already active');
    }
    AutomationRuntimeService.owner = this; this.activeConfig = config; this.status = 'STARTING'; this.lastError = null;
    try {
      await this.recoverInterruptedRuns();
      this.startedAt = this.now(); this.status = 'RUNNING';
      await this.event('RUNTIME_STARTED', { pollIntervalMs: config.pollIntervalMs, maxRetries: config.maxRetries });
      this.schedule(0);
      return this.getHealth();
    } catch (error) {
      this.status = 'ERROR'; this.lastError = safeName(error); AutomationRuntimeService.owner = null;
      await this.event('RUNTIME_TICK_FAILED', { errorType: this.lastError }); throw error;
    }
  }

  private schedule(delay: number) {
    if (this.status !== 'RUNNING' || this.timer) return;
    this.nextTickAt = new Date(this.now().getTime() + delay);
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.triggerTick().catch(() => undefined).finally(() => {
        if (this.status === 'RUNNING') this.schedule(this.activeConfig?.pollIntervalMs ?? 60_000);
      });
    }, delay);
  }

  triggerTick(): Promise<TickResult> {
    const config = this.activeConfig ?? this.config();
    if (!config.enabled) return Promise.reject(new AutomationRuntimeDisabledError());
    if (this.tickPromise) return this.tickPromise;
    const operation = this.executeTick(config).finally(() => { this.tickPromise = null; });
    this.tickPromise = operation;
    return operation;
  }

  private async executeTick(config: AutomationRuntimeConfig): Promise<TickResult> {
    const at = this.now(); this.lastTickAt = at; this.nextTickAt = null;
    await this.event('RUNTIME_TICK_STARTED');
    try {
      const scheduler = this.scheduler ??= new AutomationSchedulerService();
      const result = await scheduler.runDueAutomations(at, config.maxRetries);
      this.dueCount = result.due; this.runsStarted += result.results.filter(({ created }) => created).length;
      this.runsFailed += result.results.filter((item) => 'run' in item && item.run.status === 'FAILED').length;
      this.lastSuccessfulTickAt = this.now(); this.lastError = null;
      if (result.missed > 0) await this.event('MISSED_OCCURRENCE', { count: result.missed });
      await this.event('RUNTIME_TICK_COMPLETED', { due: result.due, missed: result.missed,
        runsStarted: result.results.filter(({ created }) => created).length,
        runsFailed: result.results.filter((item) => 'run' in item && item.run.status === 'FAILED').length });
      return result;
    } catch (error) {
      this.status = 'ERROR'; this.lastError = safeName(error);
      await this.event('RUNTIME_TICK_FAILED', { errorType: this.lastError }); throw error;
    }
  }

  async stop() {
    if (this.status === 'STOPPED') return this.getHealth();
    if (this.status === 'STOPPING') { if (this.tickPromise) await this.tickPromise.catch(() => undefined); return this.getHealth(); }
    this.status = 'STOPPING';
    if (this.timer) { this.timers.clear(this.timer); this.timer = null; }
    this.nextTickAt = null;
    if (this.tickPromise) await this.tickPromise.catch(() => undefined);
    await this.event('RUNTIME_STOPPED');
    this.status = 'STOPPED'; this.startedAt = null; this.activeConfig = null;
    if (AutomationRuntimeService.owner === this) AutomationRuntimeService.owner = null;
    return this.getHealth();
  }

  listEvents(limit = 100) { return this.events.listRecent(limit); }
}

export const automationRuntime = new AutomationRuntimeService();
