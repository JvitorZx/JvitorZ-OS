export interface RawVideoPerformanceRecord {
  videoId: unknown;
  title: unknown;
  projectId?: unknown;
  game?: unknown;
  series?: unknown;
  format?: unknown;
  publishedAt?: unknown;
  periodStart?: unknown;
  periodEnd?: unknown;
  views?: unknown;
  impressions?: unknown;
  ctr?: unknown;
  durationSeconds?: unknown;
  averageViewDurationSeconds?: unknown;
  averageViewPercentage?: unknown;
  watchTimeMinutes?: unknown;
  subscribersGained?: unknown;
  subscribersLost?: unknown;
  likes?: unknown;
  comments?: unknown;
  confidence?: unknown;
  collectedAt?: unknown;
}

export interface PerformanceProvider {
  readonly name: string;
  fetch(): Promise<readonly RawVideoPerformanceRecord[]>;
}

export class ManualPerformanceProvider implements PerformanceProvider {
  readonly name = 'manual';

  constructor(private readonly records: readonly RawVideoPerformanceRecord[]) {}

  async fetch(): Promise<readonly RawVideoPerformanceRecord[]> {
    return this.records.map((record) => ({ ...record }));
  }
}
