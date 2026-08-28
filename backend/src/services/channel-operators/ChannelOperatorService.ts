import type { AudienceSnapshot, VideoPerformanceSnapshot, VideoReachSnapshot } from '@prisma/client';
import { AudienceSnapshotRepository } from '../../database/repositories/AudienceSnapshotRepository';
import { DatabaseService } from '../../database/DatabaseService';
import { VideoPerformanceSnapshotRepository } from '../../database/repositories/VideoPerformanceSnapshotRepository';
import { VideoReachSnapshotRepository } from '../../database/repositories/VideoReachSnapshotRepository';
import { DataQualityService, type DataQualityReport } from '../../domains/data-quality/DataQualityService';
import {
  CHANNEL_OPERATOR_IDS,
  type ChannelOperatorAnalysis,
  type ChannelOperatorEvidence,
  type ChannelOperatorId,
  type ChannelOperatorSignal,
} from '../../domains/channel-operators';

const definitions: Record<ChannelOperatorId, Pick<ChannelOperatorAnalysis, 'name' | 'responsibility'>> = {
  ctr: { name: 'Operador de CTR', responsibility: 'Analisar embalagem e distribuição sem atribuir causalidade à thumbnail.' },
  retention: { name: 'Operador de Retenção', responsibility: 'Diagnosticar consumo médio, duração e watch time do conteúdo.' },
  'long-form': { name: 'Operador de Longos', responsibility: 'Consolidar performance editorial de vídeos long-form identificados.' },
  shorts: { name: 'Operador de Shorts', responsibility: 'Consolidar performance de conteúdos explicitamente identificados como Shorts.' },
};

const numeric = (value: number | null): value is number => typeof value === 'number' && Number.isFinite(value);
const median = (values: Array<number | null>): number | null => {
  const sorted = values.filter(numeric).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const total = (values: Array<number | null>) => values.filter(numeric).reduce((sum, value) => sum + value, 0);
const totalOrNull = (values: Array<number | null>) => values.some(numeric) ? total(values) : null;
const normalizedFormat = ({ format }: VideoPerformanceSnapshot) => format?.trim().toLowerCase() ?? '';
const isShort = (snapshot: VideoPerformanceSnapshot) => /(^|\W)short(s)?($|\W)/.test(normalizedFormat(snapshot));
const isLongForm = (snapshot: VideoPerformanceSnapshot) => /long|vod|video longo|vídeo longo/.test(normalizedFormat(snapshot));
const boundedConfidence = (sampleSize: number, availableFields: number, expectedFields: number) =>
  Number(Math.min(1, (sampleSize / 5) * (availableFields / expectedFields)).toFixed(2));
const evidence = (snapshot: VideoPerformanceSnapshot, fields: Array<keyof VideoPerformanceSnapshot>): ChannelOperatorEvidence => ({
  snapshotId: snapshot.id,
  videoId: snapshot.videoId,
  title: snapshot.title,
  collectedAt: snapshot.collectedAt,
  metrics: Object.fromEntries(fields.map((field) => [field, numeric(snapshot[field] as number | null) ? snapshot[field] : null])) as Record<string, number | null>,
});
const rankedSignals = (
  records: VideoPerformanceSnapshot[],
  field: 'ctr' | 'averageViewPercentage' | 'views' | 'watchTimeMinutes',
  reference: number | null,
  label: string,
): ChannelOperatorSignal[] => {
  if (reference === null || reference === 0) return [];
  const signals: ChannelOperatorSignal[] = [];
  for (const record of records.filter((item) => numeric(item[field]))) {
    const value = record[field] as number;
    const ratio = value / reference;
    if (ratio >= 1.15) signals.push({ classification: 'fact', direction: 'positive',
      summary: `${record.title}: ${label} acima da mediana observada.`, videoId: record.videoId, snapshotId: record.id });
    else if (ratio <= 0.85) signals.push({ classification: 'fact', direction: 'negative',
      summary: `${record.title}: ${label} abaixo da mediana observada.`, videoId: record.videoId, snapshotId: record.id });
  }
  return signals.slice(0, 8);
};

export class ChannelOperatorNotFoundError extends Error {
  constructor() { super('Channel operator not found'); this.name = 'ChannelOperatorNotFoundError'; }
}

export class ChannelOperatorService {
  constructor(
    private readonly snapshots = new VideoPerformanceSnapshotRepository(DatabaseService.client),
    private readonly reach = new VideoReachSnapshotRepository(DatabaseService.client),
    private readonly qualityService = new DataQualityService(),
    private readonly audience = new AudienceSnapshotRepository(DatabaseService.client),
  ) {}

  private async audienceRows(filters: { projectId?: string | null }): Promise<AudienceSnapshot[]> {
    try { return await this.audience.findAll(filters); } catch { return []; }
  }

  async list(projectId?: string | null): Promise<ChannelOperatorAnalysis[]> {
    const filters = projectId === undefined ? {} : { projectId };
    const [records, reach, audience] = await Promise.all([this.snapshots.findAll(filters), this.reach.findAll(filters), this.audienceRows(filters)]);
    const quality = this.qualityService.evaluateReach(reach, { knownVideoIds: new Set(records.map(({ videoId }) => videoId)) });
    return CHANNEL_OPERATOR_IDS.map((id) => this.analyze(id, records, reach, quality, audience));
  }

  async run(id: string, projectId?: string | null): Promise<ChannelOperatorAnalysis> {
    if (!CHANNEL_OPERATOR_IDS.includes(id as ChannelOperatorId)) throw new ChannelOperatorNotFoundError();
    const filters = projectId === undefined ? {} : { projectId };
    const [records, reach, audience] = await Promise.all([this.snapshots.findAll(filters), this.reach.findAll(filters), this.audienceRows(filters)]);
    const quality = this.qualityService.evaluateReach(reach, { knownVideoIds: new Set(records.map(({ videoId }) => videoId)) });
    return this.analyze(id as ChannelOperatorId, records, reach, quality, audience);
  }

  private base(id: ChannelOperatorId, records: VideoPerformanceSnapshot[], sample: VideoPerformanceSnapshot[], missingData: string[], availableFields: number, expectedFields: number) {
    return {
      id, ...definitions[id],
      status: records.length === 0 ? 'NOT_CONFIGURED' as const : missingData.length > 0 ? 'LIMITED' as const : 'AVAILABLE' as const,
      missingData, source: 'persisted-youtube-performance' as const, sampleSize: sample.length,
      confidence: boundedConfidence(sample.length, availableFields, expectedFields),
      lastDataAt: records[0]?.collectedAt ?? null,
    };
  }

  private analyze(id: ChannelOperatorId, records: VideoPerformanceSnapshot[], reach: VideoReachSnapshot[], quality: DataQualityReport, audience: AudienceSnapshot[]): ChannelOperatorAnalysis {
    if (id === 'ctr') return this.ctr(records, reach, quality, audience);
    if (id === 'retention') return this.retention(records, audience);
    return this.format(id, records, audience);
  }

  private ctr(records: VideoPerformanceSnapshot[], reach: VideoReachSnapshot[], quality: DataQualityReport, audience: AudienceSnapshot[]): ChannelOperatorAnalysis {
    const sample = reach.filter(({ ctr, impressions }) => numeric(ctr) && numeric(impressions));
    const ctrMedian = median(sample.map(({ ctr }) => ctr));
    const impressionsMedian = median(sample.map(({ impressions }) => impressions));
    const missingData = sample.length === 0 ? ['YouTube reach report (impressions, CTR)'] : [];
    const metadata = new Map(records.map((record) => [record.videoId, record]));
    const formatGroups = new Map<string, VideoReachSnapshot[]>();
    for (const item of sample) {
      const format = metadata.get(item.videoId)?.format?.trim() || 'formato não classificado';
      formatGroups.set(format, [...(formatGroups.get(format) ?? []), item]);
    }
    const baselines = [
      { scope: 'canal', median: ctrMedian, sampleSize: sample.length },
      ...[...formatGroups.entries()].map(([scope, items]) => ({ scope: `formato:${scope}`, median: median(items.map(({ ctr }) => ctr)), sampleSize: items.length })),
    ];
    const signals: ChannelOperatorSignal[] = [];
    for (const item of sample) {
      if (ctrMedian !== null && impressionsMedian !== null) {
        if (item.impressions >= impressionsMedian && item.ctr < ctrMedian * 0.85) signals.push({ classification: 'fact', direction: 'negative', summary: `${metadata.get(item.videoId)?.title ?? item.videoId}: alcance acima da mediana e CTR abaixo da baseline observada.`, videoId: item.videoId, snapshotId: item.id });
        if (item.impressions < impressionsMedian && item.ctr >= ctrMedian * 1.15) signals.push({ classification: 'inference', direction: 'neutral', summary: `${metadata.get(item.videoId)?.title ?? item.videoId}: CTR acima da baseline em alcance ainda abaixo da mediana; ampliação de distribuição permanece incerta.`, videoId: item.videoId, snapshotId: item.id });
      }
    }
    const byVideo = new Map<string, VideoReachSnapshot[]>();
    for (const item of sample) byVideo.set(item.videoId, [...(byVideo.get(item.videoId) ?? []), item]);
    for (const [videoId, items] of byVideo) {
      const ordered = [...items].sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime());
      if (ordered.length < 2 || ordered[0].ctr === 0) continue;
      const ratio = ordered.at(-1)!.ctr / ordered[0].ctr;
      if (ratio >= 1.15) signals.push({ classification: 'fact', direction: 'positive', summary: `${metadata.get(videoId)?.title ?? videoId}: CTR em alta no período observado.`, videoId, snapshotId: ordered.at(-1)!.id });
      if (ratio <= 0.85) signals.push({ classification: 'fact', direction: 'negative', summary: `${metadata.get(videoId)?.title ?? videoId}: CTR em queda no período observado.`, videoId, snapshotId: ordered.at(-1)!.id });
    }
    if (sample.length < 3) signals.push({ classification: 'inference', direction: 'neutral', summary: 'Amostra insuficiente para comparação robusta de embalagem e distribuição.' });
    return {
      id: 'ctr', ...definitions.ctr,
      status: sample.length ? 'AVAILABLE' : records.length ? 'LIMITED' : 'NOT_CONFIGURED',
      missingData, source: 'youtube-reporting-reach', sampleSize: sample.length,
      confidence: Number((boundedConfidence(sample.length, sample.length ? 2 : 0, 2) * quality.consistency * (quality.freshness === 'RECENT' ? 1 : 0.65)).toFixed(2)),
      lastDataAt: quality.latestCollectedAt,
      facts: [
        { label: 'Períodos com CTR real', value: sample.length, unit: 'count', source: 'youtube-reporting-reach' },
        { label: 'CTR mediano', value: ctrMedian, unit: 'percent', source: 'youtube-reporting-reach' },
        { label: 'Impressões observadas', value: total(sample.map(({ impressions }) => impressions)), unit: 'count', source: 'youtube-reporting-reach' },
      ],
      signals: signals.slice(0, 12),
      insights: sample.length ? ['Fato: o CTR mede cliques sobre impressões. Hipótese: título, thumbnail, tema e origem da distribuição podem contribuir, mas o relatório não prova causalidade.', ...this.trafficContext(audience)] : [],
      recommendations: sample.length ? ['Compare itens dentro do mesmo formato e janela antes de testar uma mudança de embalagem.'] : ['Configure e sincronize o relatório oficial de alcance do YouTube.'],
      evidence: sample.slice(0, 20).map((item) => ({ snapshotId: item.id, videoId: item.videoId, title: metadata.get(item.videoId)?.title ?? item.videoId, collectedAt: item.collectedAt, source: 'youtube-reporting-reach', periodStart: item.periodStart, periodEnd: item.periodEnd, metrics: { impressions: item.impressions, ctr: item.ctr, views: metadata.get(item.videoId)?.views ?? null } })),
      quality: { state: quality.state, freshness: quality.freshness, completeness: quality.completeness, consistency: quality.consistency, sourceReliability: quality.sourceReliability, reasons: quality.reasons },
      baselines,
    };
  }

  private retention(records: VideoPerformanceSnapshot[], audience: AudienceSnapshot[]): ChannelOperatorAnalysis {
    const sample = records.filter(({ averageViewDurationSeconds, averageViewPercentage, watchTimeMinutes }) =>
      numeric(averageViewDurationSeconds) || numeric(averageViewPercentage) || numeric(watchTimeMinutes));
    const percentageMedian = median(sample.map(({ averageViewPercentage }) => averageViewPercentage));
    const missingData = records.length === 0 ? ['performance snapshots'] : sample.length === 0
      ? ['averageViewDuration', 'averageViewPercentage', 'watchTime'] : ['retention curve / initial retention'];
    const availableFields = Number(sample.some(({ averageViewDurationSeconds }) => numeric(averageViewDurationSeconds)))
      + Number(sample.some(({ averageViewPercentage }) => numeric(averageViewPercentage)))
      + Number(sample.some(({ watchTimeMinutes }) => numeric(watchTimeMinutes)));
    return {
      ...this.base('retention', records, sample, missingData, availableFields, 3),
      facts: [
        { label: 'Vídeos com consumo medido', value: sample.length, unit: 'count', source: 'persisted-youtube-performance' },
        { label: 'Retenção média mediana', value: percentageMedian, unit: 'percent', source: 'persisted-youtube-performance' },
        { label: 'Duração média mediana', value: median(sample.map(({ averageViewDurationSeconds }) => averageViewDurationSeconds)), unit: 'seconds', source: 'persisted-youtube-performance' },
        { label: 'Watch time observado', value: totalOrNull(sample.map(({ watchTimeMinutes }) => watchTimeMinutes)), unit: 'minutes', source: 'persisted-youtube-performance' },
      ],
      signals: rankedSignals(sample, 'averageViewPercentage', percentageMedian, 'retenção média'),
      insights: sample.length ? ['Os dados disponíveis descrevem retenção média; não existe granularidade suficiente para afirmar onde ocorre abandono.', ...this.trafficContext(audience)] : [],
      recommendations: sample.length ? ['Compare retenção média junto de duração e watch time; obtenha curva granular antes de diagnosticar a abertura.'] : ['Sincronize métricas de duração média e watch time.'],
      evidence: sample.slice(0, 20).map((item) => evidence(item, ['durationSeconds', 'averageViewDurationSeconds', 'averageViewPercentage', 'watchTimeMinutes'])),
    };
  }

  private trafficContext(audience: AudienceSnapshot[]): string[] {
    const rows = audience.filter(({ dimension }) => dimension === 'traffic_source');
    if (!rows.length) return [];
    const totals = new Map<string, number>(); for (const row of rows) totals.set(row.segment, (totals.get(row.segment) ?? 0) + (row.views ?? 0));
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? [`Contexto de origem: ${top[0]} lidera as views observadas; isso não prova a causa do CTR ou da retenção.`] : [];
  }

  private format(id: 'long-form' | 'shorts', records: VideoPerformanceSnapshot[], audience: AudienceSnapshot[]): ChannelOperatorAnalysis {
    const sample = records.filter(id === 'shorts' ? isShort : isLongForm);
    const fields = [
      ['views', sample.some(({ views }) => numeric(views))],
      ['watchTime', sample.some(({ watchTimeMinutes }) => numeric(watchTimeMinutes))],
      ['averageViewPercentage', sample.some(({ averageViewPercentage }) => numeric(averageViewPercentage))],
      ['subscribersGained', sample.some(({ subscribersGained }) => numeric(subscribersGained))],
    ] as const;
    const audienceRows = audience.filter(({ format }) => format === (id === 'shorts' ? 'SHORTS' : 'LONG_FORM'));
    const audienceQuality = this.qualityService.evaluateAudience(audienceRows, ['traffic_source', 'country', 'device_type', 'subscribed_status']);
    const topBy = (dimension: string) => {
      const totals = new Map<string, number>(); for (const row of audienceRows.filter((item) => item.dimension === dimension)) totals.set(row.segment, (totals.get(row.segment) ?? 0) + (row.views ?? 0));
      return [...totals.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
    };
    const topTraffic = topBy('traffic_source'); const topCountry = topBy('country'); const topDevice = topBy('device_type'); const topSubscribed = topBy('subscribed_status');
    const missingData = records.length === 0
      ? ['performance snapshots']
      : sample.length === 0
        ? [`explicit ${id} format classification`]
        : [...fields.filter(([, available]) => !available).map(([field]) => field), ...(!audienceRows.length ? ['audience / traffic source by format'] : [])];
    const availableFields = fields.filter(([, available]) => available).length;
    const viewsMedian = median(sample.map(({ views }) => views));
    const best = [...sample].filter(({ views }) => numeric(views)).sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0];
    const worst = [...sample].filter(({ views }) => numeric(views)).sort((a, b) => (a.views ?? 0) - (b.views ?? 0))[0];
    const signals: ChannelOperatorSignal[] = [
      ...(best ? [{ classification: 'fact' as const, direction: 'positive' as const, summary: `${best.title}: maior volume de views na amostra ${id}.`, videoId: best.videoId, snapshotId: best.id }] : []),
      ...(worst && worst.id !== best?.id ? [{ classification: 'fact' as const, direction: 'negative' as const, summary: `${worst.title}: menor volume de views na amostra ${id}.`, videoId: worst.videoId, snapshotId: worst.id }] : []),
    ];
    return {
      ...this.base(id, records, sample, missingData, availableFields, 4),
      facts: [
        { label: `Vídeos ${id}`, value: sample.length, unit: 'count', source: 'persisted-youtube-performance' },
        { label: 'Views medianas', value: viewsMedian, unit: 'count', source: 'persisted-youtube-performance' },
        { label: 'Watch time observado', value: totalOrNull(sample.map(({ watchTimeMinutes }) => watchTimeMinutes)), unit: 'minutes', source: 'persisted-youtube-performance' },
        { label: 'Inscritos ganhos', value: totalOrNull(sample.map(({ subscribersGained }) => subscribersGained)), unit: 'count', source: 'persisted-youtube-performance' },
        ...(topTraffic ? [{ label: 'Principal fonte', value: topTraffic[0], source: 'youtube-analytics-audience' as const }] : []),
        ...(topCountry ? [{ label: 'Principal país', value: topCountry[0], source: 'youtube-analytics-audience' as const }] : []),
        ...(topDevice ? [{ label: 'Principal dispositivo', value: topDevice[0], source: 'youtube-analytics-audience' as const }] : []),
        ...(topSubscribed ? [{ label: 'Principal status de inscrição', value: topSubscribed[0], source: 'youtube-analytics-audience' as const }] : []),
      ],
      signals,
      insights: sample.length ? [`A comparação usa somente snapshots explicitamente classificados como ${id}; associação não implica causalidade editorial.`] : [],
      recommendations: sample.length ? ['Compare tema, jogo, formato e retenção dos extremos antes do próximo teste editorial.'] : [`Classifique o formato dos snapshots para habilitar a análise ${id}.`],
      evidence: sample.slice(0, 20).map((item) => evidence(item, ['views', 'watchTimeMinutes', 'averageViewDurationSeconds', 'averageViewPercentage', 'subscribersGained'])),
      quality: { state: audienceQuality.state, freshness: audienceQuality.freshness, completeness: audienceQuality.completeness, consistency: audienceQuality.consistency, sourceReliability: audienceQuality.sourceReliability, reasons: audienceQuality.reasons },
    };
  }
}
