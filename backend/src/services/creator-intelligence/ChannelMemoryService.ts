import type { ChannelInsight, Prisma } from '@prisma/client';
import type { EvidenceClassification } from '../../domains/creator-intelligence/types';
import { clampScore } from '../../domains/creator-intelligence/types';
import { DatabaseService } from '../../database/DatabaseService';
import {
  ChannelInsightRepository,
  type UpsertChannelInsightData,
} from '../../database/repositories/ChannelInsightRepository';
import { PerformanceSignalRepository } from '../../database/repositories/PerformanceSignalRepository';
import { VideoPerformanceSnapshotRepository } from '../../database/repositories/VideoPerformanceSnapshotRepository';
import { calculatePerformanceBaseline } from '../performance-intelligence/PerformanceBaselineService';

export interface RecordChannelLearningInput {
  projectId?: string | null;
  category: string;
  subject: string;
  statement: string;
  confidence: number;
  classification: EvidenceClassification;
  evidence?: Prisma.InputJsonValue;
}

const normalizeKeyPart = (value: string): string =>
  value.trim().toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const buildLearningKey = (projectId: string | null, category: string, subject: string): string =>
  `${projectId ?? 'global'}:${normalizeKeyPart(category)}:${normalizeKeyPart(subject)}`;

export class ChannelMemoryService {
  private insightRepository?: ChannelInsightRepository;
  private signalRepository?: PerformanceSignalRepository;
  private snapshotRepository?: VideoPerformanceSnapshotRepository;

  constructor(
    insightRepository?: ChannelInsightRepository,
    signalRepository?: PerformanceSignalRepository,
    snapshotRepository?: VideoPerformanceSnapshotRepository,
  ) {
    this.insightRepository = insightRepository;
    this.signalRepository = signalRepository;
    this.snapshotRepository = snapshotRepository;
  }

  private get snapshots(): VideoPerformanceSnapshotRepository {
    if (!this.snapshotRepository) {
      this.snapshotRepository = new VideoPerformanceSnapshotRepository(DatabaseService.client);
    }
    return this.snapshotRepository;
  }

  private get insights(): ChannelInsightRepository {
    if (!this.insightRepository) {
      this.insightRepository = new ChannelInsightRepository(DatabaseService.client);
    }
    return this.insightRepository;
  }

  private get signals(): PerformanceSignalRepository {
    if (!this.signalRepository) {
      this.signalRepository = new PerformanceSignalRepository(DatabaseService.client);
    }
    return this.signalRepository;
  }

  async recordLearning(input: RecordChannelLearningInput): Promise<ChannelInsight> {
    const projectId = input.projectId?.trim() || null;
    const data: UpsertChannelInsightData = {
      key: buildLearningKey(projectId, input.category, input.subject),
      projectId,
      category: input.category.trim(),
      subject: input.subject.trim(),
      statement: input.statement.trim(),
      confidence: Math.min(1, Math.max(0, input.confidence)),
      classification: input.classification,
      evidence: input.evidence ?? undefined,
    };
    return this.insights.upsert(data);
  }

  async listMemory(projectId?: string | null): Promise<ChannelInsight[]> {
    return this.insights.findByProject(projectId?.trim() || null);
  }

  async refreshFromPerformance(projectId?: string | null): Promise<ChannelInsight[]> {
    const normalizedProjectId = projectId?.trim() || null;
    const signals = await this.signals.findByProject(normalizedProjectId);
    const groups = new Map<string, typeof signals>();

    for (const signal of signals) {
      const dimensions: Array<[string, string | null]> = [
        ['game', signal.game],
        ['series', signal.series],
        ['format', signal.format],
      ];
      for (const [category, subject] of dimensions) {
        if (!subject) continue;
        const key = `${category}:${subject}`;
        groups.set(key, [...(groups.get(key) ?? []), signal]);
      }
    }

    const refreshed: ChannelInsight[] = [];
    for (const [groupKey, groupSignals] of groups) {
      const separator = groupKey.indexOf(':');
      const category = groupKey.slice(0, separator);
      const subject = groupKey.slice(separator + 1);
      const totalSamples = groupSignals.reduce(
        (total, signal) => total + Math.max(1, signal.sampleSize),
        0,
      );
      const average = clampScore(groupSignals.reduce(
        (total, signal) => total + clampScore(signal.value) * Math.max(1, signal.sampleSize),
        0,
      ) / totalSamples);
      const confidence = Math.min(0.95, 0.25 + Math.log10(totalSamples + 1) * 0.3);

      refreshed.push(await this.recordLearning({
        projectId: normalizedProjectId,
        category,
        subject,
        statement: `Sinal histórico de ${subject}: desempenho relativo ${average.toFixed(1)}/100 em ${totalSamples} amostra(s).`,
        confidence,
        classification: 'inference',
        evidence: { average, sampleSize: totalSamples, derivedFrom: 'PerformanceSignal' },
      }));
    }

    return refreshed;
  }

  async refreshFromSnapshots(projectId?: string | null): Promise<ChannelInsight[]> {
    const normalizedProjectId = projectId?.trim() || null;
    const snapshots = await this.snapshots.findAll({ projectId: normalizedProjectId });
    const baseline = calculatePerformanceBaseline(snapshots, normalizedProjectId);
    const dimensions: Array<['game' | 'series' | 'format', keyof Pick<typeof snapshots[number], 'game' | 'series' | 'format'>]> = [
      ['game', 'game'],
      ['series', 'series'],
      ['format', 'format'],
    ];
    const refreshed: ChannelInsight[] = [];

    for (const [category, field] of dimensions) {
      const subjects = [...new Set(snapshots.flatMap((snapshot) => snapshot[field] ? [snapshot[field]] : []))];
      for (const subject of subjects) {
        const group = snapshots.filter((snapshot) => snapshot[field] === subject && snapshot.views !== null);
        if (group.length === 0 || baseline.views.median === null) continue;
        const averageViews = group.reduce((sum, snapshot) => sum + (snapshot.views ?? 0), 0) / group.length;
        const relative = baseline.views.median > 0 ? (averageViews / baseline.views.median) * 100 : 100;
        const confidence = Math.min(0.95, group.reduce((sum, item) => sum + item.confidence, 0) / group.length * Math.min(1, group.length / 3));
        refreshed.push(await this.recordLearning({
          projectId: normalizedProjectId,
          category: `performance_${category}`,
          subject,
          statement: `${subject} apresenta views médias equivalentes a ${relative.toFixed(0)}% da mediana dinâmica do canal em ${group.length} vídeo(s).`,
          confidence,
          classification: 'inference',
          evidence: {
            snapshotIds: group.map(({ id }) => id),
            metric: 'views',
            averageViews,
            baselineMedian: baseline.views.median,
            sampleSize: group.length,
            derivedFrom: 'VideoPerformanceSnapshot',
          },
        }));
      }
    }
    const channelPatterns = [
      {
        category: 'performance_watch_time',
        subject: 'watch time',
        metric: 'watchTimeMinutes',
        baseline: baseline.watchTimeMinutes,
        unit: 'minutos',
      },
      {
        category: 'performance_retention',
        subject: 'retenção média',
        metric: 'averageViewPercentage',
        baseline: baseline.averageViewPercentage,
        unit: '%',
      },
      {
        category: 'performance_subscriber_conversion',
        subject: 'conversão em inscritos',
        metric: 'subscribersPerThousandViews',
        baseline: baseline.subscribersPerThousandViews,
        unit: 'inscritos por mil views',
      },
    ];
    for (const pattern of channelPatterns) {
      if (pattern.baseline.median === null) continue;
      refreshed.push(await this.recordLearning({
        projectId: normalizedProjectId,
        category: pattern.category,
        subject: pattern.subject,
        statement: `A baseline observada de ${pattern.subject} é mediana ${pattern.baseline.median.toFixed(1)} ${pattern.unit}, em ${pattern.baseline.sampleSize} vídeo(s).`,
        confidence: Math.min(0.95, pattern.baseline.sampleSize / 5),
        classification: 'inference',
        evidence: {
          metric: pattern.metric,
          average: pattern.baseline.average,
          median: pattern.baseline.median,
          sampleSize: pattern.baseline.sampleSize,
          derivedFrom: 'VideoPerformanceSnapshot',
        },
      }));
    }
    const activeKeys = new Set(refreshed.map(({ key }) => key));
    const previous = await this.insights.findByProject(normalizedProjectId);
    for (const insight of previous) {
      if (!insight.category.startsWith('performance_') || activeKeys.has(insight.key)) continue;
      refreshed.push(await this.recordLearning({
        projectId: normalizedProjectId,
        category: insight.category,
        subject: insight.subject,
        statement: 'Este aprendizado foi invalidado porque os dados de origem atuais não são suficientes.',
        confidence: 0,
        classification: 'unknown',
        evidence: { invalidated: true, derivedFrom: 'VideoPerformanceSnapshot' },
      }));
    }
    return refreshed;
  }
}
