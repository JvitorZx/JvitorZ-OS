import { createHash } from 'crypto';
import type { Prisma, VideoPerformanceSnapshot } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { AudienceSnapshotRepository } from '../../database/repositories/AudienceSnapshotRepository';
import { ContentPatternRepository } from '../../database/repositories/ContentPatternRepository';
import { SeriesDefinitionRepository } from '../../database/repositories/SeriesDefinitionRepository';
import { VideoPerformanceSnapshotRepository } from '../../database/repositories/VideoPerformanceSnapshotRepository';
import { DataQualityService } from '../../domains/data-quality/DataQualityService';
import type { ContentPatternAnalysis, TrendQuality } from '../../domains/trend-intelligence';

const MINIMUM_PATTERN_SAMPLE = 3;
const RECENT_DAYS = 90;
const normalize = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const keyFor = (...parts: Array<string | null>) => createHash('sha256').update(parts.join('|')).digest('hex');
const median = (values: readonly number[]) => {
  const ordered = [...values].sort((a, b) => a - b); if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2); return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};
const dateOf = (row: VideoPerformanceSnapshot) => row.periodEnd ?? row.publishedAt ?? row.collectedAt;

export class ContentPatternIntelligenceService {
  constructor(
    private readonly snapshots = new VideoPerformanceSnapshotRepository(DatabaseService.client),
    private readonly patterns = new ContentPatternRepository(DatabaseService.client),
    private readonly series = new SeriesDefinitionRepository(DatabaseService.client),
    private readonly audience = new AudienceSnapshotRepository(DatabaseService.client),
    private readonly dataQuality = new DataQualityService(),
  ) {}

  private quality(rows: readonly VideoPerformanceSnapshot[], now: Date): TrendQuality {
    if (!rows.length) return { state: 'MISSING', completeness: 0, consistency: 1, freshness: 'MISSING', reasons: ['Nenhuma evidência persistida.'] };
    const known = rows.filter(({ views }) => views !== null).length;
    const latest = rows.reduce((value, row) => dateOf(row) > value ? dateOf(row) : value, dateOf(rows[0]));
    const stale = now.getTime() - latest.getTime() > 35 * 86_400_000;
    return {
      state: stale ? 'STALE' : known < rows.length || rows.length < MINIMUM_PATTERN_SAMPLE ? 'PARTIAL' : 'GOOD',
      completeness: Number((known / rows.length).toFixed(2)),
      consistency: Number((rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length).toFixed(2)),
      freshness: stale ? 'STALE' : 'RECENT', reasons: stale ? ['A evidência não é recente.'] : [],
    };
  }

  private analyzeGroup(subject: string, patternType: ContentPatternAnalysis['patternType'], rows: VideoPerformanceSnapshot[], baseline: number | null, now: Date): ContentPatternAnalysis {
    const values = rows.flatMap(({ views }) => views === null ? [] : [views]);
    const groupMedian = median(values);
    const ratio = baseline && groupMedian !== null ? groupMedian / baseline : null;
    const classification = rows.length < MINIMUM_PATTERN_SAMPLE || groupMedian === null || baseline === null || baseline === 0
      ? 'INSUFFICIENT_DATA' : ratio! >= 1.15 ? 'STRONG' : ratio! <= 0.85 ? 'WEAK' : 'NEUTRAL';
    const association = classification === 'INSUFFICIENT_DATA'
      ? `${subject}: ainda não há amostra comparável suficiente.`
      : `${subject}: mediana de views ${classification === 'STRONG' ? 'acima' : classification === 'WEAK' ? 'abaixo' : 'próxima'} da baseline recente do canal.`;
    return {
      subject, patternType, classification, association,
      hypothesis: 'Associação observada para priorizar um teste; não demonstra causalidade editorial.',
      sampleSize: rows.length,
      confidence: classification === 'INSUFFICIENT_DATA' ? Math.min(0.3, rows.length / 10) : Number(Math.min(1, (rows.length / 8) * this.quality(rows, now).completeness).toFixed(2)),
      evidence: rows.filter(({ views }) => views !== null).slice(0, 16).map((row) => ({ snapshotId: row.id, videoId: row.videoId, metric: 'views', value: row.views! })),
      quality: this.quality(rows, now), detectedAt: now,
    };
  }

  async detect(input: { projectId?: string | null; now?: Date } = {}) {
    const projectId = input.projectId?.trim() || null;
    const now = input.now ?? new Date();
    const all = await this.snapshots.findAll({ projectId });
    const anchor = all.length ? all.reduce((date, row) => dateOf(row) > date ? dateOf(row) : date, dateOf(all[0])) : now;
    const cutoff = new Date(anchor.getTime() - RECENT_DAYS * 86_400_000);
    const rows = all.filter((row) => dateOf(row) >= cutoff);
    const baseline = median(rows.flatMap(({ views }) => views === null ? [] : [views]));
    const groups = new Map<string, { subject: string; type: ContentPatternAnalysis['patternType']; rows: VideoPerformanceSnapshot[] }>();
    const add = (subject: string | null, type: ContentPatternAnalysis['patternType'], row: VideoPerformanceSnapshot) => {
      if (!subject?.trim()) return; const key = `${type}:${normalize(subject)}`;
      const group = groups.get(key) ?? { subject: subject.trim(), type, rows: [] }; group.rows.push(row); groups.set(key, group);
    };
    for (const row of rows) { add(row.game, 'GAME', row); add(row.format, 'FORMAT', row); add(row.series, 'SERIES', row); }
    for (const definition of await this.series.findAll(projectId)) {
      if (!definition.topic?.trim()) continue;
      for (const link of definition.videoLinks) add(definition.topic, 'TOPIC', link.sourceSnapshot);
    }
    const analyses = [...groups.values()].map((group) => this.analyzeGroup(group.subject, group.type, group.rows, baseline, now));

    const audience = await this.audience.findAll({ projectId });
    const audienceQuality = this.dataQuality.evaluateAudience(audience, ['traffic_source'], now);
    const trafficGroups = new Map<string, typeof audience>();
    for (const row of audience.filter(({ dimension }) => dimension === 'traffic_source')) {
      const key = `${row.format ?? 'ALL'}:${row.segment}`;
      trafficGroups.set(key, [...(trafficGroups.get(key) ?? []), row]);
    }
    for (const [subject, sample] of trafficGroups) {
      const views = sample.reduce((sum, row) => sum + (row.views ?? 0), 0);
      analyses.push({
        subject, patternType: 'TRAFFIC_MIX', classification: sample.length >= 2 ? 'NEUTRAL' : 'INSUFFICIENT_DATA',
        association: `${subject}: ${views} views atribuídas à origem na amostra persistida.`,
        hypothesis: 'A origem pode orientar distribuição e embalagem, mas não prova a causa da performance.',
        sampleSize: sample.length, confidence: sample.length >= 2 ? 0.5 * audienceQuality.completeness : 0.2,
        evidence: sample.slice(0, 16).map((row) => ({ snapshotId: row.id, metric: 'views', value: row.views ?? 0 })),
        quality: { state: audienceQuality.state === 'ERROR' ? 'INCONSISTENT' : audienceQuality.state,
          completeness: audienceQuality.completeness, consistency: audienceQuality.consistency,
          freshness: audienceQuality.freshness, reasons: audienceQuality.reasons.map(({ message }) => message) }, detectedAt: now,
      });
    }
    await Promise.all(analyses.map((pattern) => this.patterns.upsert({
      projectId, key: keyFor(projectId, pattern.patternType, normalize(pattern.subject)), subject: pattern.subject,
      patternType: pattern.patternType, classification: pattern.classification,
      game: pattern.patternType === 'GAME' ? pattern.subject : null,
      topic: pattern.patternType === 'TOPIC' ? pattern.subject : null,
      format: pattern.patternType === 'FORMAT' ? pattern.subject : null,
      series: pattern.patternType === 'SERIES' ? pattern.subject : null,
      summary: `${pattern.association} Hipótese: ${pattern.hypothesis}`,
      sampleSize: pattern.sampleSize, confidence: pattern.confidence,
      evidence: pattern.evidence as unknown as Prisma.InputJsonValue,
      quality: pattern.quality as unknown as Prisma.InputJsonValue, detectedAt: pattern.detectedAt,
    })));
    return analyses;
  }

  async list(filters: { projectId?: string | null; patternType?: string; refresh?: boolean; now?: Date } = {}) {
    const projectId = filters.projectId?.trim() || null;
    if (filters.refresh !== false) await this.detect({ projectId, now: filters.now });
    return this.patterns.findAll({ projectId, ...(filters.patternType ? { patternType: filters.patternType } : {}) });
  }

  async performanceBySubject(type: 'GAME' | 'TOPIC', projectId?: string | null, now = new Date()) {
    const patterns = await this.list({ projectId, patternType: type, now });
    return patterns.map((pattern) => ({
      subject: pattern.subject,
      performance: pattern.classification === 'STRONG' ? 'strong' : pattern.classification === 'WEAK' ? 'weak'
        : pattern.classification === 'NEUTRAL' ? 'neutral' : 'insufficient',
      sampleSize: pattern.sampleSize, confidence: pattern.confidence, evidence: pattern.evidence,
      quality: pattern.quality, detectedAt: pattern.detectedAt,
    }));
  }
}
