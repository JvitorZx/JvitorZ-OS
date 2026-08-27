import type { VideoPerformanceSnapshot } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { VideoPerformanceSnapshotRepository } from '../../database/repositories/VideoPerformanceSnapshotRepository';
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
  constructor(private readonly snapshots = new VideoPerformanceSnapshotRepository(DatabaseService.client)) {}

  async list(projectId?: string | null): Promise<ChannelOperatorAnalysis[]> {
    const records = await this.snapshots.findAll(projectId === undefined ? {} : { projectId });
    return CHANNEL_OPERATOR_IDS.map((id) => this.analyze(id, records));
  }

  async run(id: string, projectId?: string | null): Promise<ChannelOperatorAnalysis> {
    if (!CHANNEL_OPERATOR_IDS.includes(id as ChannelOperatorId)) throw new ChannelOperatorNotFoundError();
    const records = await this.snapshots.findAll(projectId === undefined ? {} : { projectId });
    return this.analyze(id as ChannelOperatorId, records);
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

  private analyze(id: ChannelOperatorId, records: VideoPerformanceSnapshot[]): ChannelOperatorAnalysis {
    if (id === 'ctr') return this.ctr(records);
    if (id === 'retention') return this.retention(records);
    return this.format(id, records);
  }

  private ctr(records: VideoPerformanceSnapshot[]): ChannelOperatorAnalysis {
    const sample = records.filter(({ ctr, impressions }) => numeric(ctr) && numeric(impressions));
    const ctrMedian = median(sample.map(({ ctr }) => ctr));
    const missingData = records.length === 0 ? ['performance snapshots'] : sample.length === 0 ? ['impressions', 'ctr'] : [];
    return {
      ...this.base('ctr', records, sample, missingData, sample.length ? 2 : 0, 2),
      facts: [
        { label: 'Vídeos com CTR real', value: sample.length, unit: 'count', source: 'persisted-youtube-performance' },
        { label: 'CTR mediano', value: ctrMedian, unit: 'percent', source: 'persisted-youtube-performance' },
        { label: 'Impressões observadas', value: total(sample.map(({ impressions }) => impressions)), unit: 'count', source: 'persisted-youtube-performance' },
      ],
      signals: rankedSignals(sample, 'ctr', ctrMedian, 'CTR'),
      insights: sample.length ? ['CTR descreve resposta à embalagem e distribuição; isoladamente não identifica a causa do resultado.'] : [],
      recommendations: sample.length ? ['Investigue título, thumbnail, tema e fonte de tráfego dos vídeos fora da faixa observada antes de alterar a embalagem.'] : ['Sincronize impressões e CTR no YouTube Analytics.'],
      evidence: sample.slice(0, 20).map((item) => evidence(item, ['impressions', 'ctr', 'views'])),
    };
  }

  private retention(records: VideoPerformanceSnapshot[]): ChannelOperatorAnalysis {
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
      insights: sample.length ? ['Os dados disponíveis descrevem retenção média; não existe granularidade suficiente para afirmar onde ocorre abandono.'] : [],
      recommendations: sample.length ? ['Compare retenção média junto de duração e watch time; obtenha curva granular antes de diagnosticar a abertura.'] : ['Sincronize métricas de duração média e watch time.'],
      evidence: sample.slice(0, 20).map((item) => evidence(item, ['durationSeconds', 'averageViewDurationSeconds', 'averageViewPercentage', 'watchTimeMinutes'])),
    };
  }

  private format(id: 'long-form' | 'shorts', records: VideoPerformanceSnapshot[]): ChannelOperatorAnalysis {
    const sample = records.filter(id === 'shorts' ? isShort : isLongForm);
    const fields = [
      ['views', sample.some(({ views }) => numeric(views))],
      ['watchTime', sample.some(({ watchTimeMinutes }) => numeric(watchTimeMinutes))],
      ['averageViewPercentage', sample.some(({ averageViewPercentage }) => numeric(averageViewPercentage))],
      ['subscribersGained', sample.some(({ subscribersGained }) => numeric(subscribersGained))],
    ] as const;
    const missingData = records.length === 0
      ? ['performance snapshots']
      : sample.length === 0
        ? [`explicit ${id} format classification`]
        : fields.filter(([, available]) => !available).map(([field]) => field);
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
      ],
      signals,
      insights: sample.length ? [`A comparação usa somente snapshots explicitamente classificados como ${id}; associação não implica causalidade editorial.`] : [],
      recommendations: sample.length ? ['Compare tema, jogo, formato e retenção dos extremos antes do próximo teste editorial.'] : [`Classifique o formato dos snapshots para habilitar a análise ${id}.`],
      evidence: sample.slice(0, 20).map((item) => evidence(item, ['views', 'watchTimeMinutes', 'averageViewDurationSeconds', 'averageViewPercentage', 'subscribersGained'])),
    };
  }
}
