export const GOVERNANCE_DECISIONS = ['ALLOW', 'DEFER', 'BLOCK', 'REQUIRE_APPROVAL'] as const;
export type GovernanceDecisionType = typeof GOVERNANCE_DECISIONS[number];
export const AUTOMATION_HEALTH = ['HEALTHY', 'DEGRADED', 'BLOCKED', 'FAILING', 'DISABLED'] as const;
export type AutomationHealth = typeof AUTOMATION_HEALTH[number];

export interface ExecutionWindow { start: string; end: string; weekdays?: number[] }
export interface AutomationGovernanceInput {
  enabled?: boolean;
  maxRunsPerDay?: number | null;
  maxRunsPerWeek?: number | null;
  cooldownMinutes?: number | null;
  allowedExecutionWindows?: ExecutionWindow[] | null;
  maxConsecutiveFailures?: number | null;
  pauseOnRepeatedFailure?: boolean;
  manualApprovalRequired?: boolean;
  retryPolicy?: { maxRetries: number } | null;
}
export interface GovernanceOverride {
  policies: Array<'quota' | 'window' | 'cooldown'>;
  reason: string;
  authorizedBy: string;
}
export interface GovernanceDecision {
  decision: GovernanceDecisionType;
  reasons: string[];
  blockedPolicies: string[];
  nextEligibleAt: Date | null;
  facts: string[];
}

export const DEFAULT_AUTOMATION_GOVERNANCE = Object.freeze({
  enabled: true, maxRunsPerDay: 10, maxRunsPerWeek: 50, cooldownMinutes: 0,
  allowedExecutionWindows: [] as ExecutionWindow[], maxConsecutiveFailures: 3,
  pauseOnRepeatedFailure: true, manualApprovalRequired: false, retryPolicy: { maxRetries: 0 },
});
