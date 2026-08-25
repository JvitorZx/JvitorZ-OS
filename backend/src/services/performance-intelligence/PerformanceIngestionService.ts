import type { PerformanceSignal, VideoPerformanceSnapshot } from '@prisma/client';
import type { PerformanceProvider } from '../../domains/performance-intelligence/PerformanceProvider';
import { clampScore } from '../../domains/creator-intelligence/types';
import { DatabaseService } from '../../database/DatabaseService';
import {
  PerformanceSignalRepository,
  type CreatePerformanceSignalData,
} from '../../database/repositories/PerformanceSignalRepository';
import { VideoPerformanceSnapshotRepository } from '../../database/repositories/VideoPerformanceSnapshotRepository';
import { calculatePerformanceBaseline } from './PerformanceBaselineService';
import { normalizePerformanceRecord } from './PerformanceNormalizer';

export interface PerformanceIngestionResult {
  source: string;
  created: number;
  updated: number;
  records: VideoPerformanceSnapshot[];
  signals: PerformanceSignal[];
}

const relativeScore = (value: number, baseline: number): number => (
  baseline <= 0 ? 50 : clampScore((value / baseline) * 50)
);

export class PerformanceIngestionService {
  private snapshotRepository?: VideoPerformanceSnapshotRepository;
  private signalRepository?: PerformanceSignalRepository;

  constructor(
    snapshotRepository?: VideoPerformanceSnapshotRepository,
    signalRepository?: PerformanceSignalRepository,
  ) {
    this.snapshotRepository = snapshotRepository;
    this.signalRepository = signalRepository;
  }

  private get snapshots(): VideoPerformanceSnapshotRepository {
    if (!this.snapshotRepository) {
      this.snapshotRepository = new VideoPerformanceSnapshotRepository(DatabaseService.client);
    }
    return this.snapshotRepository;
  }

  private get signals(): PerformanceSignalRepository {
    if (!this.signalRepository) {
      this.signalRepository = new PerformanceSignalRepository(DatabaseService.client);
    }
    return this.signalRepository;
  }

  private buildSignals(
    snapshot: VideoPerformanceSnapshot,
    population: readonly VideoPerformanceSnapshot[],
  ): CreatePerformanceSignalData[] {
    const baseline = calculatePerformanceBaseline(population, snapshot.projectId);
    const common = {
      projectId: snapshot.projectId,
      videoIdeaId: null,
      performanceSnapshotId: snapshot.id,
      game: snapshot.game,
      series: snapshot.series,
      format: snapshot.format,
      sampleSize: 1,
      source: `${snapshot.source}:${snapshot.id}`,
      classification: 'real',
      confidence: snapshot.confidence,
      measuredAt: snapshot.collectedAt,
    };
    const candidates: Array<[string, number | null, number | null, boolean]> = [
      ['game_performance', snapshot.views, baseline.views.median, Boolean(snapshot.game)],
      ['series_performance', snapshot.views, baseline.views.median, Boolean(snapshot.series)],
      ['format_performance', snapshot.views, baseline.views.median, Boolean(snapshot.format)],
      ['watch_time_performance', snapshot.watchTimeMinutes, baseline.watchTimeMinutes.median, true],
      ['retention_performance', snapshot.averageViewPercentage, baseline.averageViewPercentage.median, true],
      [
        'subscriber_conversion',
        snapshot.views !== null && snapshot.views > 0 && snapshot.subscribersGained !== null
          ? (snapshot.subscribersGained / snapshot.views) * 1_000
          : null,
        baseline.subscribersPerThousandViews.median,
        true,
      ],
    ];
    return candidates.flatMap(([metric, value, reference, applies]) => (
      applies && value !== null && reference !== null
        ? [{ ...common, key: `${snapshot.id}:${metric}`, metric, value: relativeScore(value, reference) }]
        : []
    ));
  }

  async ingest(provider: PerformanceProvider, projectId?: string | null): Promise<PerformanceIngestionResult> {
    const rawRecords = await provider.fetch();
    const normalizedProjectId = projectId?.trim() || null;
    const saved: VideoPerformanceSnapshot[] = [];
    let created = 0;
    let updated = 0;

    for (const raw of rawRecords) {
      const result = await this.snapshots.upsert(
        normalizePerformanceRecord(raw, provider.name, normalizedProjectId),
      );
      saved.push(result.snapshot);
      if (result.created) created += 1;
      else updated += 1;
    }

    const allSignals: PerformanceSignal[] = [];
    const populations = new Map<string, VideoPerformanceSnapshot[]>();
    for (const snapshot of saved) {
      const key = snapshot.projectId ?? '__global__';
      let population = populations.get(key);
      if (!population) {
        population = await this.snapshots.findAll({ projectId: snapshot.projectId });
        populations.set(key, population);
      }
      allSignals.push(...await this.signals.replaceForSnapshot(
        snapshot.id,
        this.buildSignals(snapshot, population),
      ));
    }

    return { source: provider.name, created, updated, records: saved, signals: allSignals };
  }
}
