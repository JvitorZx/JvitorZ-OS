import { createHash } from 'crypto';
import type { AudienceSnapshot, Prisma, TrendSignal, VideoPerformanceSnapshot } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { AudienceSnapshotRepository } from '../../database/repositories/AudienceSnapshotRepository';
import { TrendSignalRepository } from '../../database/repositories/TrendSignalRepository';
import { VideoPerformanceSnapshotRepository } from '../../database/repositories/VideoPerformanceSnapshotRepository';
import { DataQualityService } from '../../domains/data-quality/DataQualityService';
import { detectTrend, TrendWindowPolicy, type DetectedTrend, type TrendQuality, type TrendSubjectType } from '../../domains/trend-intelligence';

type PerformanceMetric = 'views' | 'watchTimeMinutes' | 'averageViewDurationSeconds' | 'averageViewPercentage' | 'subscribersGained' | 'ctr' | 'impressions';
const METRICS: Array<{ field: PerformanceMetric; aggregate: 'sum' | 'mean' }> = [
  { field: 'views', aggregate: 'sum' },
  { field: 'watchTimeMinutes', aggregate: 'sum' },
  { field: 'averageViewDurationSeconds', aggregate: 'mean' },
  { field: 'averageViewPercentage', aggregate: 'mean' },
  { field: 'subscribersGained', aggregate: 'sum' },
  { field: 'ctr', aggregate: 'mean' },
  { field: 'impressions', aggregate: 'sum' },
];

const normalize = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const keyFor = (...parts: Array<string | null | number>) => createHash('sha256').update(parts.join('|')).digest('hex');
const occurredAt = (row: VideoPerformanceSnapshot): Date => row.periodEnd ?? row.publishedAt ?? row.collectedAt;
const inWindow = (date: Date, start: Date, end: Date) => date >= start && date < end;
const latestPerVideo = (rows: readonly VideoPerformanceSnapshot[]) => {
  const selected = new Map<string, VideoPerformanceSnapshot>();
  for (const row of [...rows].sort((a, b) => b.collectedAt.getTime() - a.collectedAt.getTime())) {
    if (!selected.has(row.videoId)) selected.set(row.videoId, row);
  }
  return [...selected.values()];
};
const rounded = (value: number): number => Number(Math.max(0, Math.min(1, value)).toFixed(2));

export class TrendNotFoundError extends Error {
  constructor() { super('Trend not found'); this.name = 'TrendNotFoundError'; }
}

export class TrendIntelligenceService {
  constructor(
    private readonly snapshots = new VideoPerformanceSnapshotRepository(DatabaseService.client),
    private readonly audience = new AudienceSnapshotRepository(DatabaseService.client),
    private readonly trends = new TrendSignalRepository(DatabaseService.client),
    private readonly windows = new TrendWindowPolicy(),
    private readonly dataQuality = new DataQualityService(),
  ) {}

  private performanceQuality(rows: readonly VideoPerformanceSnapshot[], metric: PerformanceMetric, now: Date): TrendQuality {
    if (!rows.length) return { state: 'MISSING', completeness: 0, consistency: 1, freshness: 'MISSING', reasons: ['Nenhum snapshot de performance disponível.'] };
    const valid = rows.filter((row) => typeof row[metric] === 'number' && Number.isFinite(row[metric])).length;
    const latest = rows.reduce((date, row) => occurredAt(row) > date ? occurredAt(row) : date, occurredAt(rows[0]));
    const ageDays = Math.max(0, (now.getTime() - latest.getTime()) / 86_400_000);
    const freshness = ageDays <= 14 ? 'RECENT' : ageDays <= 35 ? 'STALE' : 'HISTORICAL';
    const completeness = rounded(valid / rows.length);
    const confidenceConsistency = rounded(rows.reduce((sum, row) => sum + Math.max(0, Math.min(1, row.confidence)), 0) / rows.length);
    const reasons: string[] = [];
    if (completeness < 1) reasons.push(`${metric}: há valores ausentes na amostra.`);
    if (freshness !== 'RECENT') reasons.push('Os dados de performance não são recentes.');
    return {
      state: freshness !== 'RECENT' ? 'STALE' : completeness < 1 || rows.length < 4 ? 'PARTIAL' : 'GOOD',
      completeness, consistency: confidenceConsistency, freshness, reasons,
    };
  }

  private groups(rows: readonly VideoPerformanceSnapshot[]) {
    const groups = new Map<string, { subject: string; subjectType: TrendSubjectType; rows: VideoPerformanceSnapshot[] }>();
    const add = (subject: string, subjectType: TrendSubjectType, row: VideoPerformanceSnapshot) => {
      const key = `${subjectType}:${normalize(subject)}`;
      const entry = groups.get(key) ?? { subject, subjectType, rows: [] };
      entry.rows.push(row); groups.set(key, entry);
    };
    for (const row of rows) {
      add('Canal', 'CHANNEL', row);
      if (row.format?.trim()) add(row.format.trim(), 'FORMAT', row);
      if (row.game?.trim()) add(row.game.trim(), 'GAME', row);
      if (row.series?.trim()) add(row.series.trim(), 'SERIES', row);
    }
    if (!groups.size) groups.set('CHANNEL:canal', { subject: 'Canal', subjectType: 'CHANNEL', rows: [] });
    return [...groups.values()];
  }

  private async persist(projectId: string | null, days: 7 | 28, trend: DetectedTrend): Promise<TrendSignal> {
    return this.trends.upsert({
      projectId,
      key: keyFor(projectId, days, trend.subjectType, normalize(trend.subject), trend.metric),
      subject: trend.subject,
      subjectType: trend.subjectType,
      metric: trend.metric,
      classification: trend.classification,
      currentWindow: trend.currentWindow as unknown as Prisma.InputJsonValue,
      previousWindow: trend.previousWindow as unknown as Prisma.InputJsonValue,
      delta: trend.delta,
      sampleSize: trend.sampleSize,
      confidence: trend.confidence,
      evidence: { items: trend.evidence, reasons: trend.reasons } as unknown as Prisma.InputJsonValue,
      quality: trend.quality as unknown as Prisma.InputJsonValue,
      detectedAt: trend.detectedAt,
    });
  }

  private async detectAudience(projectId: string | null, days: 7 | 28, now: Date): Promise<DetectedTrend[]> {
    const rows = await this.audience.findAll({ projectId });
    const pair = this.windows.calendar(days, now);
    const report = this.dataQuality.evaluateAudience(rows, ['traffic_source', 'country', 'device_type', 'subscribed_status'], now);
    const quality: TrendQuality = {
      state: report.state === 'ERROR' ? 'INCONSISTENT' : report.state,
      completeness: report.completeness, consistency: report.consistency, freshness: report.freshness,
      reasons: report.reasons.map(({ message }) => message),
    };
    const dimensions = new Map<string, AudienceSnapshot[]>();
    for (const row of rows.filter(({ dimension }) => dimension === 'traffic_source' || dimension === 'subscribed_status')) {
      const key = `${row.dimension}:${row.segment}`;
      dimensions.set(key, [...(dimensions.get(key) ?? []), row]);
    }
    return [...dimensions.values()].map((sample) => {
      const first = sample[0];
      const subjectType: TrendSubjectType = first.dimension === 'traffic_source' ? 'TRAFFIC_SOURCE' : 'AUDIENCE_SEGMENT';
      const observations = sample.filter(({ views }) => views !== null).map((row) => ({ id: row.id, value: row.views!, occurredAt: row.periodEnd }));
      return detectTrend({ subject: first.segment, subjectType, metric: 'views_mix', windows: pair,
        current: observations.filter(({ occurredAt: date }) => inWindow(date, pair.current.start, pair.current.end)),
        previous: observations.filter(({ occurredAt: date }) => inWindow(date, pair.previous.start, pair.previous.end)),
        quality, detectedAt: now, aggregate: 'sum' });
    });
  }

  async detect(input: { projectId?: string | null; days?: 7 | 28; now?: Date } = {}): Promise<TrendSignal[]> {
    const projectId = input.projectId?.trim() || null;
    const days = input.days ?? 28;
    const rows = await this.snapshots.findAll({ projectId });
    const anchor = input.now ?? new Date();
    const pair = this.windows.calendar(days, anchor);
    const detected: DetectedTrend[] = [];
    for (const group of this.groups(rows)) {
      for (const spec of METRICS) {
        const quality = this.performanceQuality(group.rows, spec.field, anchor);
        const observations = latestPerVideo(group.rows).flatMap((row) => {
          const value = row[spec.field];
          return typeof value === 'number' && Number.isFinite(value)
            ? [{ id: row.id, videoId: row.videoId, value, occurredAt: occurredAt(row) }] : [];
        });
        detected.push(detectTrend({ subject: group.subject, subjectType: group.subjectType, metric: spec.field,
          windows: pair,
          current: observations.filter(({ occurredAt: date }) => inWindow(date, pair.current.start, pair.current.end)),
          previous: observations.filter(({ occurredAt: date }) => inWindow(date, pair.previous.start, pair.previous.end)),
          quality, detectedAt: anchor, aggregate: spec.aggregate }));
      }
    }
    detected.push(...await this.detectAudience(projectId, days, anchor));
    return Promise.all(detected.map((trend) => this.persist(projectId, days, trend)));
  }

  async list(filters: { projectId?: string | null; subjectType?: string; classification?: string; refresh?: boolean; days?: 7 | 28; now?: Date } = {}) {
    const projectId = filters.projectId?.trim() || null;
    if (filters.refresh !== false) await this.detect({ projectId, days: filters.days, now: filters.now });
    return this.trends.findAll({ projectId, ...(filters.subjectType ? { subjectType: filters.subjectType } : {}), ...(filters.classification ? { classification: filters.classification } : {}) });
  }

  async getById(id: string): Promise<TrendSignal> {
    const trend = await this.trends.findById(id.trim());
    if (!trend) throw new TrendNotFoundError();
    return trend;
  }
}
