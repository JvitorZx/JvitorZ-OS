import { DatabaseService } from '../../database/DatabaseService';
import { AutomationRepository } from '../../database/repositories/AutomationRepository';
import { AutomationRunRepository } from '../../database/repositories/AutomationRunRepository';
import type { AutomationHealth } from '../../domains/automation';
import { automationRuntime, type AutomationRuntimeService } from './AutomationRuntimeService';
import { AutomationGovernanceService } from './AutomationGovernanceService';

export class AutomationDiagnosticsService {
  constructor(
    private readonly governance = new AutomationGovernanceService(),
    private readonly automations = new AutomationRepository(DatabaseService.client),
    private readonly runs = new AutomationRunRepository(DatabaseService.client),
    private readonly runtime: Pick<AutomationRuntimeService, 'getHealth'> = automationRuntime,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async diagnose(automationId: string) {
    const usage = await this.governance.getUsage(automationId, this.now());
    const eligibility = await this.governance.evaluate(automationId, 'SCHEDULED', this.now(), undefined, false);
    const awaitingReview = await this.runs.findAwaitingReview(automationId); const runtime = this.runtime.getHealth();
    let health: AutomationHealth = 'HEALTHY';
    if (!usage.automation.enabled || usage.automation.status === 'DISABLED' || !usage.policy.enabled) health = 'DISABLED';
    else if (usage.automation.status === 'ERROR' || usage.failures >= usage.policy.maxConsecutiveFailures) health = 'FAILING';
    else if (usage.automation.status === 'BLOCKED' || usage.automation.status === 'PAUSED' || awaitingReview) health = 'BLOCKED';
    else if (usage.failures > 0 || eligibility.decision !== 'ALLOW' || runtime.status === 'ERROR') health = 'DEGRADED';
    const recommendation = health === 'HEALTHY' ? 'Nenhuma intervenção necessária.'
      : awaitingReview ? 'Revisar e aprovar ou rejeitar o plano pendente.'
        : usage.failures >= usage.policy.maxConsecutiveFailures ? 'Revisar a causa e executar recuperação manual.'
          : eligibility.nextEligibleAt ? `Aguardar até ${eligibility.nextEligibleAt.toISOString()}.`
            : 'Revisar a política e o estado operacional.';
    return {
      automationId, name: usage.automation.name, state: usage.automation.status, health,
      runtime: { status: runtime.status, enabled: runtime.enabled, lastTickAt: runtime.lastTickAt },
      nextRunAt: usage.automation.nextRunAt, nextEligibleAt: eligibility.nextEligibleAt,
      quota: { daily: { used: usage.daily, limit: usage.policy.maxRunsPerDay, remaining: Math.max(0, usage.policy.maxRunsPerDay - usage.daily), resetsAt: usage.period.dayEnd },
        weekly: { used: usage.weekly, limit: usage.policy.maxRunsPerWeek, remaining: Math.max(0, usage.policy.maxRunsPerWeek - usage.weekly), resetsAt: usage.period.weekEnd } },
      cooldownMinutes: usage.policy.cooldownMinutes, executionWindows: usage.policy.allowedExecutionWindows,
      consecutiveFailures: usage.failures, lastResult: usage.latest ? { id: usage.latest.id, status: usage.latest.status, failureReason: usage.latest.failureReason, completedAt: usage.latest.completedAt } : null,
      block: eligibility.decision === 'ALLOW' ? null : { decision: eligibility.decision, reasons: eligibility.reasons, policies: eligibility.blockedPolicies },
      approvalPending: !!awaitingReview || eligibility.blockedPolicies.includes('manualApprovalRequired')
        || (usage.policy.manualApprovalRequired && usage.automation.status === 'BLOCKED'), facts: eligibility.facts, diagnosis: eligibility.reasons, recommendation,
    };
  }

  async listDiagnostics() { const items = await this.automations.findAll(); return Promise.all(items.map(({ id }) => this.diagnose(id))); }

  async getSummary() {
    const [diagnostics, retriesPending] = await Promise.all([this.listDiagnostics(), this.runs.countPendingRetries()]);
    const count = (health: AutomationHealth) => diagnostics.filter((item) => item.health === health).length;
    return { healthy: count('HEALTHY'), degraded: count('DEGRADED'), blocked: count('BLOCKED'), failing: count('FAILING'), disabled: count('DISABLED'),
      quotasReached: diagnostics.filter((item) => item.block?.policies.some((policy) => policy.includes('Quota'))).length,
      pausedByFailure: diagnostics.filter((item) => item.state === 'PAUSED' && item.consecutiveFailures > 0).length,
      approvalsPending: diagnostics.filter((item) => item.approvalPending).length, retriesPending };
  }
}
