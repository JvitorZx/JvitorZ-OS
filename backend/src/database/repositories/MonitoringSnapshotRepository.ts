import type { Prisma, PrismaClient } from '@prisma/client';
import type { MonitoringRuleDefinition } from '../../domains/strategic-monitoring';

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export class MonitoringSnapshotRepository {
  constructor(private readonly client: PrismaClient) {}

  async ensureRules(rules: readonly MonitoringRuleDefinition[]) {
    await this.client.$transaction(rules.map((rule) => this.client.monitoringRule.upsert({
      where: { code: rule.code },
      create: { ...rule },
      update: {
        signalType: rule.signalType,
        defaultSeverity: rule.defaultSeverity,
        cooldownHours: rule.cooldownHours,
        description: rule.description,
      },
    })));
  }

  async createEvaluation(data: {
    projectId: string | null;
    evaluationFingerprint: string;
    evaluatedSources: string[];
    sourceState: Record<string, string>;
    candidateCount: number;
    evaluatedAt: Date;
  }) {
    const existing = await this.client.monitoringSnapshot.findUnique({ where: { evaluationFingerprint: data.evaluationFingerprint } });
    if (existing) return { snapshot: existing, created: false };
    try {
      const snapshot = await this.client.monitoringSnapshot.create({ data: {
        ...data,
        evaluatedSources: json(data.evaluatedSources),
        sourceState: json(data.sourceState),
        createdCount: 0,
        updatedCount: 0,
        resolvedCount: 0,
      } });
      return { snapshot, created: true };
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') throw error;
      const concurrent = await this.client.monitoringSnapshot.findUnique({ where: { evaluationFingerprint: data.evaluationFingerprint } });
      if (!concurrent) throw error;
      return { snapshot: concurrent, created: false };
    }
  }

  async complete(id: string, counts: { createdCount: number; updatedCount: number; resolvedCount: number }) {
    return this.client.monitoringSnapshot.update({ where: { id }, data: counts });
  }

  async latest(projectId?: string | null, limit = 20) {
    return this.client.monitoringSnapshot.findMany({
      where: projectId === undefined ? undefined : { projectId },
      orderBy: [{ evaluatedAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });
  }
}
