import type { Automation } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { AutomationRepository } from '../../database/repositories/AutomationRepository';
import { AutomationRunnerService } from './AutomationRunnerService';
import { AutomationAuditRepository } from '../../database/repositories/AutomationAuditRepository';
import { calculateLatestEligibleRunAt, type AutomationSchedule, type AutomationTriggerType } from '../../domains/automation';

export const AUTOMATION_RETRY_BACKOFF_MS = 1_000;

export class AutomationSchedulerService {
  constructor(
    private readonly automations = new AutomationRepository(DatabaseService.client),
    private readonly runner = new AutomationRunnerService(),
    private readonly audits = new AutomationAuditRepository(DatabaseService.client),
    private readonly delay: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  findDueAutomations(now: Date): Promise<Automation[]> {
    return this.automations.findDue(now);
  }

  async runDueAutomations(now: Date, maxRetries = 0) {
    const due = await this.findDueAutomations(now);
    const results = [];
    let missed = 0;
    for (const automation of due) {
      const latest = calculateLatestEligibleRunAt(
        automation.triggerType as AutomationTriggerType,
        automation.schedule as AutomationSchedule,
        automation.timezone,
        now,
      ) ?? automation.nextRunAt ?? now;
      if (automation.nextRunAt && latest.getTime() > automation.nextRunAt.getTime()) {
        missed += 1;
        await this.audits.append({ automationId: automation.id, eventType: 'MISSED_OCCURRENCE',
          details: { previousDueAt: automation.nextRunAt.toISOString(), selectedOccurrenceAt: latest.toISOString() } });
      }
      let output = await this.runner.runScheduled(automation.id, latest);
      while (output.run.status === 'FAILED' && output.run.failureReason === 'AutomationRuntimeTransientError'
        && output.run.attempt <= maxRetries) {
        await this.delay(AUTOMATION_RETRY_BACKOFF_MS * output.run.attempt);
        output = await this.runner.retryTechnicalRun(output.run.id, maxRetries);
        if (!output.created) break;
      }
      results.push(output);
    }
    return { checkedAt: now, due: due.length, missed, results };
  }
}
