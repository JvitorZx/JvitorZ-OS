export interface Automation {
  id: string;
  projectId?: string;
  name: string;
  description?: string;
  trigger?: string;
  action?: string;
  triggerType: 'MANUAL_ONLY' | 'DAILY' | 'WEEKLY';
  schedule?: { time: string; weekday?: number } | null;
  timezone: string;
  intent?: string;
  orchestrationInput?: Record<string, unknown>;
  status: 'DISABLED' | 'ACTIVE' | 'PAUSED' | 'BLOCKED' | 'ERROR';
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  sideEffectLevel?: 'READ_ONLY' | 'INTERNAL_WRITE' | 'EXTERNAL_READ' | 'EXTERNAL_WRITE';
  enabled: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}
