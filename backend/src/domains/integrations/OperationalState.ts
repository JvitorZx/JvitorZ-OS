export const OPERATIONAL_STATES = [
  'NOT_CONFIGURED',
  'AUTH_REQUIRED',
  'CONNECTED',
  'DEGRADED',
  'ERROR',
] as const;

export type OperationalState = typeof OPERATIONAL_STATES[number];

export type IntegrationId =
  | 'backend'
  | 'database'
  | 'googleOAuth'
  | 'youtubeData'
  | 'youtubeAnalytics'
  | 'youtubeReach'
  | 'openai'
  | 'automationRuntime';

export interface IntegrationState {
  id: IntegrationId;
  state: OperationalState;
  configured: boolean;
  available: boolean;
  stale: boolean;
  summary: string;
  lastSuccessAt: Date | null;
  action: 'CONNECT' | 'RECONNECT' | 'SYNC' | 'CONFIGURE' | null;
}
