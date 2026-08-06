export interface AnalyticsSnapshot {
  id: string;
  projectId?: string;
  metrics: Record<string, number>;
  summary?: string;
  createdAt: string;
}
