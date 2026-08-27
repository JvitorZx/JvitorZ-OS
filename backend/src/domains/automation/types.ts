import type { OrchestrationRequest } from '../orchestration';

export const AUTOMATION_TRIGGER_TYPES = ['MANUAL_ONLY', 'DAILY', 'WEEKLY'] as const;
export type AutomationTriggerType = typeof AUTOMATION_TRIGGER_TYPES[number];

export const AUTOMATION_STATUSES = ['DISABLED', 'ACTIVE', 'PAUSED', 'BLOCKED', 'ERROR'] as const;
export type AutomationStatus = typeof AUTOMATION_STATUSES[number];

export const AUTOMATION_RUN_STATUSES = ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED'] as const;
export type AutomationRunStatus = typeof AUTOMATION_RUN_STATUSES[number];

export interface DailyAutomationSchedule {
  time: string;
}

export interface WeeklyAutomationSchedule extends DailyAutomationSchedule {
  weekday: number;
}

export type AutomationSchedule = DailyAutomationSchedule | WeeklyAutomationSchedule | null;

export type AutomationOrchestrationInput = Omit<
  OrchestrationRequest,
  'intent' | 'idempotencyKey' | 'confirmExternalSideEffect'
>;

export interface CreateAutomationInput {
  projectId?: string | null;
  name: string;
  description?: string | null;
  triggerType: AutomationTriggerType;
  schedule?: AutomationSchedule;
  timezone?: string;
  intent: string;
  orchestrationInput?: AutomationOrchestrationInput;
  enabled?: boolean;
}

export interface UpdateAutomationInput {
  name?: string;
  description?: string | null;
  triggerType?: AutomationTriggerType;
  schedule?: AutomationSchedule;
  timezone?: string;
  intent?: string;
  orchestrationInput?: AutomationOrchestrationInput;
}
