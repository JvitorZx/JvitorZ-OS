import type { MonitoringControl } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import {
  DEFAULT_MONITORING_INTERVAL_MS,
  MonitoringControlRepository,
} from '../../database/repositories/MonitoringControlRepository';
import { StrategicMonitoringService } from './StrategicMonitoringService';

export const MONITORING_INTERVAL_OPTIONS_MS = [
  15 * 60 * 1_000,
  30 * 60 * 1_000,
  60 * 60 * 1_000,
  DEFAULT_MONITORING_INTERVAL_MS,
  12 * 60 * 60 * 1_000,
  24 * 60 * 60 * 1_000,
  7 * 24 * 60 * 60 * 1_000,
] as const;

export class MonitoringControlValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'MonitoringControlValidationError'; }
}

export class MonitoringControlConflictError extends Error {
  constructor() { super('Monitoring evaluation is already running'); this.name = 'MonitoringControlConflictError'; }
}

export interface MonitoringRuntimeHealth {
  status: string;
  enabled: boolean;
  lastSuccessfulTickAt?: Date | null;
  lastError?: string | null;
}

export type MonitoringControlRunResult = {
  status: 'SUCCEEDED';
  attempted: true;
  attempts: number;
  evaluatedAt: Date;
  evaluation: Awaited<ReturnType<StrategicMonitoringService['evaluate']>>;
  control: ReturnType<MonitoringControlService['present']>;
};

const safeName = (error: unknown) => error instanceof Error ? error.name : 'UnknownError';

export class MonitoringControlService {
  constructor(
    private readonly controls = new MonitoringControlRepository(DatabaseService.client),
    private readonly monitoring = new StrategicMonitoringService(),
    private readonly now: () => Date = () => new Date(),
    private readonly delay: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly runtimeHealth: () => MonitoringRuntimeHealth = () => ({ status: 'UNAVAILABLE', enabled: false }),
  ) {}

  present(control: MonitoringControl) {
    const runtime = this.runtimeHealth();
    const schedulerActive = control.enabled && runtime.status === 'RUNNING';
    const operationalState = control.operationalState === 'RUNNING' || control.operationalState === 'ERROR'
      ? control.operationalState
      : control.enabled && !schedulerActive ? 'WAITING_FOR_RUNTIME' : control.operationalState;
    return {
      id: control.id,
      enabled: control.enabled,
      intervalMs: control.intervalMs,
      operationalState,
      persistedState: control.operationalState,
      scheduler: {
        configured: runtime.enabled,
        active: schedulerActive,
        status: runtime.status,
        lastSuccessfulTickAt: runtime.lastSuccessfulTickAt ?? null,
        lastError: runtime.lastError ?? null,
      },
      lastRunAt: control.lastRunAt,
      lastSuccessfulRunAt: control.lastSuccessfulRunAt,
      lastFailureAt: control.lastFailureAt,
      lastErrorType: control.lastErrorType,
      nextRunAt: schedulerActive ? control.nextRunAt : null,
      updatedAt: control.updatedAt,
    };
  }

  async getState() { return this.present(await this.controls.getOrCreate()); }

  async enable() { return this.present(await this.controls.enable(this.now())); }

  async disable() { return this.present(await this.controls.disable()); }

  async updateCadence(intervalMs: number) {
    if (!MONITORING_INTERVAL_OPTIONS_MS.includes(intervalMs as typeof MONITORING_INTERVAL_OPTIONS_MS[number])) {
      throw new MonitoringControlValidationError('Unsupported monitoring interval');
    }
    return this.present(await this.controls.updateInterval(intervalMs, this.now()));
  }

  async reconcile() { return this.present(await this.controls.reconcile(this.now())); }

  async runNow(projectId?: string | null, maxRetries = 0) {
    const at = this.now();
    const claimed = await this.controls.claimRun(at, false);
    if (!claimed) throw new MonitoringControlConflictError();
    return this.execute(at, projectId?.trim() || null, maxRetries);
  }

  async runScheduled(at: Date, maxRetries = 0) {
    const claimed = await this.controls.claimRun(at, true);
    if (!claimed) {
      const state = await this.controls.getOrCreate();
      return {
        status: state.enabled && state.operationalState === 'RUNNING' ? 'ALREADY_RUNNING' as const
          : state.enabled ? 'NOT_DUE' as const : 'DISABLED' as const,
        attempted: false as const,
        attempts: 0,
        evaluatedAt: state.lastRunAt,
      };
    }
    return this.execute(at, null, maxRetries);
  }

  private async execute(at: Date, projectId: string | null, maxRetries: number): Promise<MonitoringControlRunResult> {
    const retryLimit = Math.min(2, Math.max(0, Math.trunc(maxRetries)));
    let attempts = 0;
    while (attempts <= retryLimit) {
      attempts += 1;
      try {
        const evaluation = await this.monitoring.evaluate(projectId);
        const control = await this.controls.completeSuccess(this.now());
        return { status: 'SUCCEEDED', attempted: true, attempts, evaluatedAt: at, evaluation, control: this.present(control) };
      } catch (error) {
        if (attempts > retryLimit) {
          await this.controls.completeFailure(this.now(), safeName(error));
          throw error;
        }
        await this.delay(1_000 * attempts);
      }
    }
    throw new Error('Monitoring evaluation failed');
  }
}
