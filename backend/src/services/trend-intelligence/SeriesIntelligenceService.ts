import { createHash } from 'crypto';
import type { Prisma, SeriesDefinition, VideoPerformanceSnapshot } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { EditorialDecisionOutcomeRepository } from '../../database/repositories/EditorialDecisionOutcomeRepository';
import { SeriesDefinitionRepository, type SeriesWithLinks } from '../../database/repositories/SeriesDefinitionRepository';
import { VideoPerformanceSnapshotRepository } from '../../database/repositories/VideoPerformanceSnapshotRepository';
import { detectTrend, TrendWindowPolicy, type SeriesHealthAnalysis, type TrendQuality } from '../../domains/trend-intelligence';

const normalize = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const seriesKey = (projectId: string | null, normalizedKey: string) => createHash('sha256').update(`${projectId ?? 'global'}|${normalizedKey}`).digest('hex');
const metricMedian = (values: Array<number | null>) => {
  const sorted = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const snapshotDate = (snapshot: VideoPerformanceSnapshot) => snapshot.publishedAt ?? snapshot.periodEnd ?? snapshot.collectedAt;

export class SeriesValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'SeriesValidationError'; }
}
export class SeriesNotFoundError extends Error {
  constructor() { super('Series not found'); this.name = 'SeriesNotFoundError'; }
}
export class SeriesSnapshotNotFoundError extends Error {
  constructor() { super('Performance snapshot not found'); this.name = 'SeriesSnapshotNotFoundError'; }
}

export class SeriesIntelligenceService {
  constructor(
    private readonly series = new SeriesDefinitionRepository(DatabaseService.client),
    private readonly snapshots = new VideoPerformanceSnapshotRepository(DatabaseService.client),
    private readonly outcomes = new EditorialDecisionOutcomeRepository(DatabaseService.client),
    private readonly windows = new TrendWindowPolicy(),
  ) {}

  async create(input: { projectId?: string | null; name: string; game?: string | null; topic?: string | null; status?: string; metadata?: Record<string, unknown> | null }): Promise<{ series: SeriesDefinition; created: boolean }> {
    const name = input.name?.trim();
    if (!name || name.length > 160) throw new SeriesValidationError('name is required and accepts at most 160 characters');
    const normalizedKey = normalize(name);
    const projectId = input.projectId?.trim() || null;
    const status = input.status?.trim().toUpperCase() || 'ACTIVE';
    if (!['ACTIVE', 'PAUSED', 'ARCHIVED'].includes(status)) throw new SeriesValidationError('invalid series status');
    return this.series.upsert({
      key: seriesKey(projectId, normalizedKey), projectId, name, normalizedKey,
      game: input.game?.trim() || null, topic: input.topic?.trim() || null, status,
      metadata: (input.metadata ?? null) as Prisma.InputJsonValue,
    });
  }

  async importExactMetadata(projectId?: string | null): Promise<{ seriesCreated: number; linksCreated: number }> {
    const normalizedProjectId = projectId?.trim() || null;
    const records = await this.snapshots.findAll({ projectId: normalizedProjectId });
    const latest = new Map<string, VideoPerformanceSnapshot>();
    for (const row of records) {
      if (!latest.has(row.videoId)) latest.set(row.videoId, row);
    }
    let seriesCreated = 0; let linksCreated = 0;
    for (const snapshot of latest.values()) {
      const explicitName = snapshot.series?.trim();
      if (!explicitName) continue;
      const definition = await this.create({ projectId: normalizedProjectId, name: explicitName, game: snapshot.game,
        metadata: { source: 'persisted-performance-series', rule: 'exact-metadata-only' } });
      if (definition.created) seriesCreated += 1;
      const linked = await this.series.upsertVideoLink({
        seriesId: definition.series.id, sourceSnapshotId: snapshot.id, videoId: snapshot.videoId,
        origin: 'IMPORTED', confidence: 1,
        evidence: { field: 'VideoPerformanceSnapshot.series', value: explicitName, match: 'exact' },
      });
      if (linked.created) linksCreated += 1;
    }
    return { seriesCreated, linksCreated };
  }

  async autoAssociate(seriesId: string, snapshotId: string) {
    const [definition, snapshot] = await Promise.all([this.series.findById(seriesId.trim()), this.snapshots.findById(snapshotId.trim())]);
    if (!definition) throw new SeriesNotFoundError();
    if (!snapshot) throw new SeriesSnapshotNotFoundError();
    if (definition.projectId !== snapshot.projectId) throw new SeriesValidationError('snapshot does not belong to series project');
    const exact = snapshot.series?.trim() && normalize(snapshot.series) === definition.normalizedKey;
    if (!exact) return { linked: false, reason: 'A associação automática exige metadata series com correspondência exata.' } as const;
    const result = await this.series.upsertVideoLink({ seriesId: definition.id, sourceSnapshotId: snapshot.id,
      videoId: snapshot.videoId, origin: 'AUTO', confidence: 1,
      evidence: { field: 'VideoPerformanceSnapshot.series', value: snapshot.series, match: 'exact' } });
    return { linked: true, ...result } as const;
  }

  async linkVideo(seriesId: string, snapshotId: string) {
    const [definition, snapshot] = await Promise.all([this.series.findById(seriesId.trim()), this.snapshots.findById(snapshotId.trim())]);
    if (!definition) throw new SeriesNotFoundError();
    if (!snapshot) throw new SeriesSnapshotNotFoundError();
    if (definition.projectId !== snapshot.projectId) throw new SeriesValidationError('snapshot does not belong to series project');
    return this.series.upsertVideoLink({ seriesId: definition.id, sourceSnapshotId: snapshot.id, videoId: snapshot.videoId,
      origin: 'MANUAL', confidence: 1, evidence: { confirmation: 'manual' } });
  }

  async unlinkVideo(seriesId: string, videoId: string): Promise<boolean> {
    if (!seriesId.trim() || !videoId.trim()) throw new SeriesValidationError('seriesId and videoId are required');
    if (!await this.series.findById(seriesId.trim())) throw new SeriesNotFoundError();
    return this.series.deleteVideoLink(seriesId.trim(), videoId.trim());
  }

  private async analyze(definition: SeriesWithLinks, now: Date): Promise<SeriesHealthAnalysis> {
    const records = definition.videoLinks.map(({ sourceSnapshot }) => sourceSnapshot)
      .sort((a, b) => snapshotDate(b).getTime() - snapshotDate(a).getTime());
    const { current, previous } = this.windows.recentItems(records, 3);
    const quality: TrendQuality = {
      state: records.length < 4 ? 'PARTIAL' : 'GOOD', completeness: records.length ? 1 : 0,
      consistency: records.length ? records.reduce((sum, row) => sum + row.confidence, 0) / records.length : 1,
      freshness: records.length && now.getTime() - snapshotDate(records[0]).getTime() <= 90 * 86_400_000 ? 'RECENT' : 'STALE',
      reasons: records.length < 4 ? ['São necessários ao menos quatro episódios para comparar janelas recentes.'] : [],
    };
    const last = records[0] ? snapshotDate(records[0]) : null;
    const pair = {
      current: { label: 'últimos 3 vídeos', start: current.at(-1) ? snapshotDate(current.at(-1)!) : now, end: current[0] ? new Date(snapshotDate(current[0]).getTime() + 1) : now },
      previous: { label: '3 vídeos anteriores', start: previous.at(-1) ? snapshotDate(previous.at(-1)!) : now, end: previous[0] ? new Date(snapshotDate(previous[0]).getTime() + 1) : now },
    };
    const trend = detectTrend({ subject: definition.name, subjectType: 'SERIES', metric: 'views', windows: pair,
      current: current.flatMap((row) => row.views === null ? [] : [{ id: row.id, videoId: row.videoId, value: row.views, occurredAt: snapshotDate(row) }]),
      previous: previous.flatMap((row) => row.views === null ? [] : [{ id: row.id, videoId: row.videoId, value: row.views, occurredAt: snapshotDate(row) }]),
      quality, detectedAt: now, aggregate: 'mean' });
    const outcomeRows = (await Promise.all(records.slice(0, 20).map((row) => this.outcomes.findAll({ videoId: row.videoId, limit: 10 }).catch(() => [])))).flat();
    const outcomeCounts: Record<string, number> = {};
    for (const outcome of outcomeRows) outcomeCounts[outcome.classification] = (outcomeCounts[outcome.classification] ?? 0) + 1;
    const dormant = last === null || now.getTime() - last.getTime() > 90 * 86_400_000;
    const health = records.length < 4 || trend.classification === 'INSUFFICIENT_DATA' ? 'INSUFFICIENT_DATA'
      : dormant ? 'DORMANT'
        : trend.classification === 'RISING' && trend.confidence >= 0.6 ? 'STRONG'
          : trend.classification === 'DECLINING' ? 'DECLINING'
            : trend.classification === 'VOLATILE' ? 'VOLATILE' : 'HEALTHY';
    const missingData = [
      ...(records.length < 4 ? ['ao menos quatro episódios com métricas comparáveis'] : []),
      ...(!records.some(({ ctr }) => ctr !== null) ? ['CTR'] : []),
      ...(!outcomeRows.length ? ['outcomes editoriais vinculados'] : []),
    ];
    return {
      seriesId: definition.id, name: definition.name, health, trend: trend.classification,
      sampleSize: records.length, confidence: trend.confidence,
      evidence: records.slice(0, 12).map((row) => ({ snapshotId: row.id, videoId: row.videoId, title: row.title, views: row.views, collectedAt: row.collectedAt })),
      reasons: [...trend.reasons, ...(dormant ? ['DORMANT indica ausência de publicação recente; não significa falha editorial.'] : [])],
      missingData,
      metrics: {
        viewsMedian: metricMedian(records.map(({ views }) => views)),
        watchTimeMedian: metricMedian(records.map(({ watchTimeMinutes }) => watchTimeMinutes)),
        retentionMedian: metricMedian(records.map(({ averageViewPercentage }) => averageViewPercentage)),
        ctrMedian: metricMedian(records.map(({ ctr }) => ctr)),
        subscribersMedian: metricMedian(records.map(({ subscribersGained }) => subscribersGained)),
      },
      outcomes: { sampleSize: outcomeRows.length, classifications: outcomeCounts }, lastPublishedAt: last,
    };
  }

  async list(projectId?: string | null, now = new Date()) {
    const normalizedProjectId = projectId?.trim() || null;
    await this.importExactMetadata(normalizedProjectId);
    const definitions = await this.series.findAll(normalizedProjectId);
    return Promise.all(definitions.map(async (definition) => ({ series: definition, health: await this.analyze(definition, now) })));
  }

  async getById(id: string, now = new Date()) {
    const definition = await this.series.findById(id.trim());
    if (!definition) throw new SeriesNotFoundError();
    return { series: definition, health: await this.analyze(definition, now) };
  }
}
