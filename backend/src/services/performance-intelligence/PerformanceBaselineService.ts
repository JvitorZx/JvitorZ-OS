import type { VideoPerformanceSnapshot } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { VideoPerformanceSnapshotRepository } from '../../database/repositories/VideoPerformanceSnapshotRepository';

export interface MetricBaseline {
  average: number | null;
  median: number | null;
  sampleSize: number;
}

export interface PerformanceBaseline {
  projectId: string | null;
  views: MetricBaseline;
  watchTimeMinutes: MetricBaseline;
  averageViewDurationSeconds: MetricBaseline;
  averageViewPercentage: MetricBaseline;
  subscribersGained: MetricBaseline;
  subscribersPerThousandViews: MetricBaseline;
  byFormat: Record<string, { views: MetricBaseline }>;
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const metric = (values: readonly (number | null)[]): MetricBaseline => {
  const known = values.filter((value): value is number => value !== null);
  return {
    average: known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0) / known.length,
    median: median(known),
    sampleSize: known.length,
  };
};

export const calculatePerformanceBaseline = (
  snapshots: readonly VideoPerformanceSnapshot[],
  projectId: string | null,
): PerformanceBaseline => {
  const conversion = snapshots.map(({ views, subscribersGained }) => (
    views !== null && views > 0 && subscribersGained !== null
      ? (subscribersGained / views) * 1_000
      : null
  ));
  const byFormat: PerformanceBaseline['byFormat'] = {};
  for (const snapshot of snapshots) {
    if (!snapshot.format) continue;
    const group = snapshots.filter(({ format }) => format === snapshot.format);
    byFormat[snapshot.format] = { views: metric(group.map(({ views }) => views)) };
  }
  return {
    projectId,
    views: metric(snapshots.map(({ views }) => views)),
    watchTimeMinutes: metric(snapshots.map(({ watchTimeMinutes }) => watchTimeMinutes)),
    averageViewDurationSeconds: metric(snapshots.map(({ averageViewDurationSeconds }) => averageViewDurationSeconds)),
    averageViewPercentage: metric(snapshots.map(({ averageViewPercentage }) => averageViewPercentage)),
    subscribersGained: metric(snapshots.map(({ subscribersGained }) => subscribersGained)),
    subscribersPerThousandViews: metric(conversion),
    byFormat,
  };
};

export class PerformanceBaselineService {
  private repository?: VideoPerformanceSnapshotRepository;

  constructor(repository?: VideoPerformanceSnapshotRepository) {
    this.repository = repository;
  }

  private get snapshots(): VideoPerformanceSnapshotRepository {
    if (!this.repository) {
      this.repository = new VideoPerformanceSnapshotRepository(DatabaseService.client);
    }
    return this.repository;
  }

  async getBaseline(projectId?: string | null): Promise<PerformanceBaseline> {
    const normalizedProjectId = projectId?.trim() || null;
    const snapshots = await this.snapshots.findAll({ projectId: normalizedProjectId });
    return calculatePerformanceBaseline(snapshots, normalizedProjectId);
  }
}
