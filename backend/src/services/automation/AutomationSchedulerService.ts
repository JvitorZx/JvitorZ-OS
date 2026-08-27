import type { Automation } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { AutomationRepository } from '../../database/repositories/AutomationRepository';
import { AutomationRunnerService } from './AutomationRunnerService';

export class AutomationSchedulerService {
  constructor(
    private readonly automations = new AutomationRepository(DatabaseService.client),
    private readonly runner = new AutomationRunnerService(),
  ) {}

  findDueAutomations(now: Date): Promise<Automation[]> {
    return this.automations.findDue(now);
  }

  async runDueAutomations(now: Date) {
    const due = await this.findDueAutomations(now);
    const results = [];
    for (const automation of due) {
      results.push(await this.runner.runScheduled(automation.id, automation.nextRunAt ?? now));
    }
    return { checkedAt: now, due: due.length, results };
  }
}
