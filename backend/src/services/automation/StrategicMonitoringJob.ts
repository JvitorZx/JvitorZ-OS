import { DatabaseService } from '../../database/DatabaseService';
import { MonitoringSnapshotRepository } from '../../database/repositories/MonitoringSnapshotRepository';
import { StrategicMonitoringService } from '../strategic-monitoring';

export interface StrategicMonitoringJobConfig {
  enabled: boolean;
  intervalMs: number;
  projectId: string | null;
}

export type StrategicMonitoringJobResult = {
  status: 'DISABLED' | 'NOT_DUE' | 'SUCCEEDED' | 'FAILED';
  attempted: boolean;
  attempts: number;
  evaluatedAt: Date | null;
  errorType?: string;
};

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const MIN_INTERVAL_MS = 15 * 60 * 1_000;
const MAX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;

export const readStrategicMonitoringJobConfig = (): StrategicMonitoringJobConfig => {
  const rawInterval = Number(process.env.STRATEGIC_MONITORING_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  const projectId = process.env.STRATEGIC_MONITORING_PROJECT_ID?.trim() || null;
  return {
    enabled: process.env.STRATEGIC_MONITORING_ENABLED?.trim().toLowerCase() === 'true',
    intervalMs: Number.isFinite(rawInterval)
      ? Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.trunc(rawInterval)))
      : DEFAULT_INTERVAL_MS,
    projectId,
  };
};

const safeName = (error: unknown) => error instanceof Error ? error.name : 'UnknownError';

export class StrategicMonitoringJob {
  private readonly lastAttemptAt = new Map<string, Date>();

  constructor(
    private readonly monitoring = new StrategicMonitoringService(),
    private readonly snapshots = new MonitoringSnapshotRepository(DatabaseService.client),
    private readonly config: () => StrategicMonitoringJobConfig = readStrategicMonitoringJobConfig,
    private readonly delay: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async run(now: Date, maxRetries = 0): Promise<StrategicMonitoringJobResult> {
    const config = this.config();
    if (!config.enabled) return { status: 'DISABLED', attempted: false, attempts: 0, evaluatedAt: null };

    const [latest] = await this.snapshots.latest(config.projectId, 1);
    const scope = config.projectId ?? 'global';
    const lastAttempt = this.lastAttemptAt.get(scope);
    const latestEvaluation = [latest?.evaluatedAt, lastAttempt].filter((value): value is Date => Boolean(value))
      .sort((left, right) => right.getTime() - left.getTime())[0];
    if (latestEvaluation && now.getTime() - latestEvaluation.getTime() < config.intervalMs) {
      return { status: 'NOT_DUE', attempted: false, attempts: 0, evaluatedAt: latestEvaluation };
    }

    this.lastAttemptAt.set(scope, now);
    const retryLimit = Math.min(2, Math.max(0, Math.trunc(maxRetries)));
    let attempts = 0;
    while (attempts <= retryLimit) {
      attempts += 1;
      try {
        await this.monitoring.evaluate(config.projectId);
        return { status: 'SUCCEEDED', attempted: true, attempts, evaluatedAt: now };
      } catch (error) {
        if (attempts > retryLimit) {
          return { status: 'FAILED', attempted: true, attempts, evaluatedAt: now, errorType: safeName(error) };
        }
        await this.delay(1_000 * attempts);
      }
    }
    return { status: 'FAILED', attempted: true, attempts, evaluatedAt: now, errorType: 'UnknownError' };
  }
}
