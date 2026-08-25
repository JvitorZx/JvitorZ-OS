import type { ChannelInsight, Prisma } from '@prisma/client';
import type { EvidenceClassification } from '../../domains/creator-intelligence/types';
import { clampScore } from '../../domains/creator-intelligence/types';
import { DatabaseService } from '../../database/DatabaseService';
import {
  ChannelInsightRepository,
  type UpsertChannelInsightData,
} from '../../database/repositories/ChannelInsightRepository';
import { PerformanceSignalRepository } from '../../database/repositories/PerformanceSignalRepository';

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

  constructor(
    insightRepository?: ChannelInsightRepository,
    signalRepository?: PerformanceSignalRepository,
  ) {
    this.insightRepository = insightRepository;
    this.signalRepository = signalRepository;
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
}
