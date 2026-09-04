import { MonitoringControlService } from '../strategic-monitoring';

export type StrategicMonitoringJobResult = {
  status: 'DISABLED' | 'NOT_DUE' | 'ALREADY_RUNNING' | 'SUCCEEDED' | 'FAILED';
  attempted: boolean;
  attempts: number;
  evaluatedAt: Date | null;
  errorType?: string;
};

const safeName = (error: unknown) => error instanceof Error ? error.name : 'UnknownError';

// Thin scheduler adapter: cadence, locking and evaluation live in the persistent control service.
export class StrategicMonitoringJob {
  constructor(private readonly control = new MonitoringControlService()) {}

  async run(now: Date, maxRetries = 0): Promise<StrategicMonitoringJobResult> {
    try {
      const result = await this.control.runScheduled(now, maxRetries);
      return { status: result.status, attempted: result.attempted, attempts: result.attempts, evaluatedAt: result.evaluatedAt };
    } catch (error) {
      return {
        status: 'FAILED', attempted: true,
        attempts: Math.min(2, Math.max(0, Math.trunc(maxRetries))) + 1,
        evaluatedAt: now, errorType: safeName(error),
      };
    }
  }
}
