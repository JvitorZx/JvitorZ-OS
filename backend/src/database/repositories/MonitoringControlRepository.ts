import type { PrismaClient } from '@prisma/client';

export const MONITORING_CONTROL_ID = 'strategic-monitoring';
export const DEFAULT_MONITORING_INTERVAL_MS = 6 * 60 * 60 * 1_000;

export class MonitoringControlRepository {
  constructor(private readonly client: PrismaClient) {}

  getOrCreate() {
    return this.client.monitoringControl.upsert({
      where: { id: MONITORING_CONTROL_ID },
      create: { id: MONITORING_CONTROL_ID, enabled: false, intervalMs: DEFAULT_MONITORING_INTERVAL_MS },
      update: {},
    });
  }

  async enable(at: Date) {
    const current = await this.getOrCreate();
    if (current.enabled) return current;
    return this.client.monitoringControl.update({
      where: { id: MONITORING_CONTROL_ID },
      data: {
        enabled: true,
        operationalState: current.operationalState === 'RUNNING' ? 'RUNNING' : 'ACTIVE',
        nextRunAt: new Date(at.getTime() + current.intervalMs),
      },
    });
  }

  async disable() {
    const current = await this.getOrCreate();
    if (!current.enabled && current.operationalState !== 'RUNNING') return current;
    return this.client.monitoringControl.update({
      where: { id: MONITORING_CONTROL_ID },
      data: {
        enabled: false,
        operationalState: current.operationalState === 'RUNNING' ? 'RUNNING' : 'DISABLED',
        nextRunAt: null,
      },
    });
  }

  async updateInterval(intervalMs: number, at: Date) {
    const current = await this.getOrCreate();
    if (current.intervalMs === intervalMs) return current;
    return this.client.monitoringControl.update({
      where: { id: MONITORING_CONTROL_ID },
      data: {
        intervalMs,
        nextRunAt: current.enabled ? new Date(at.getTime() + intervalMs) : null,
      },
    });
  }

  async claimRun(at: Date, scheduled: boolean) {
    await this.getOrCreate();
    const claimed = await this.client.monitoringControl.updateMany({
      where: {
        id: MONITORING_CONTROL_ID,
        operationalState: { not: 'RUNNING' },
        ...(scheduled ? { enabled: true, nextRunAt: { lte: at } } : {}),
      },
      data: { operationalState: 'RUNNING', lastRunAt: at },
    });
    return claimed.count === 1 ? this.getOrCreate() : null;
  }

  async completeSuccess(at: Date) {
    return this.client.$transaction(async (transaction) => {
      const current = await transaction.monitoringControl.findUniqueOrThrow({ where: { id: MONITORING_CONTROL_ID } });
      return transaction.monitoringControl.update({
        where: { id: MONITORING_CONTROL_ID },
        data: {
          operationalState: current.enabled ? 'ACTIVE' : 'DISABLED',
          lastSuccessfulRunAt: at,
          lastErrorType: null,
          nextRunAt: current.enabled ? new Date(at.getTime() + current.intervalMs) : null,
        },
      });
    });
  }

  async completeFailure(at: Date, errorType: string) {
    return this.client.$transaction(async (transaction) => {
      const current = await transaction.monitoringControl.findUniqueOrThrow({ where: { id: MONITORING_CONTROL_ID } });
      return transaction.monitoringControl.update({
        where: { id: MONITORING_CONTROL_ID },
        data: {
          operationalState: 'ERROR',
          lastFailureAt: at,
          lastErrorType: errorType,
          nextRunAt: current.enabled ? new Date(at.getTime() + current.intervalMs) : null,
        },
      });
    });
  }

  async reconcile(at: Date) {
    const current = await this.getOrCreate();
    const interrupted = current.operationalState === 'RUNNING';
    const operationalState = current.enabled ? (interrupted ? 'ERROR' : 'ACTIVE') : 'DISABLED';
    const nextRunAt = current.enabled
      ? (current.nextRunAt ?? at)
      : null;
    if (!interrupted && current.operationalState === operationalState
      && current.nextRunAt?.getTime() === nextRunAt?.getTime()) return current;
    return this.client.monitoringControl.update({
      where: { id: MONITORING_CONTROL_ID },
      data: {
        operationalState,
        nextRunAt,
        ...(interrupted ? { lastFailureAt: at, lastErrorType: 'ProcessRestart' } : {}),
      },
    });
  }
}
