import type { Prisma, PrismaClient } from '@prisma/client';
import type { SignalState, StrategicSignalCandidate } from '../../domains/strategic-monitoring';

const details = {
  evidence: { orderBy: [{ observedAt: 'desc' }, { id: 'asc' }] },
} satisfies Prisma.StrategicSignalInclude;
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export type StrategicSignalWithEvidence = Prisma.StrategicSignalGetPayload<{ include: typeof details }>;

export class StrategicSignalRepository {
  constructor(private readonly client: PrismaClient) {}

  async findAll(filters: {
    projectId?: string | null;
    state?: string;
    severity?: string;
    type?: string;
    limit?: number;
  } = {}) {
    return this.client.strategicSignal.findMany({
      where: {
        ...(filters.projectId !== undefined ? { projectId: filters.projectId } : {}),
        ...(filters.state ? { state: filters.state } : {}),
        ...(filters.severity ? { severity: filters.severity } : {}),
        ...(filters.type ? { type: filters.type } : {}),
      },
      include: { _count: { select: { evidence: true } } },
      orderBy: [{ detectedAt: 'desc' }, { severity: 'desc' }, { id: 'asc' }],
      take: filters.limit ?? 100,
    });
  }

  async findById(id: string): Promise<StrategicSignalWithEvidence | null> {
    return this.client.strategicSignal.findUnique({ where: { id }, include: details });
  }

  async findByLogicalKey(logicalKey: string): Promise<StrategicSignalWithEvidence | null> {
    return this.client.strategicSignal.findUnique({ where: { logicalKey }, include: details });
  }

  async applyCandidate(input: {
    projectId: string | null;
    candidate: StrategicSignalCandidate;
    snapshotId: string;
    cooldownUntil: Date;
    evaluatedAt: Date;
  }): Promise<{ signal: StrategicSignalWithEvidence; created: boolean; changed: boolean }> {
    const { candidate } = input;
    return this.client.$transaction(async (transaction) => {
      const existing = await transaction.strategicSignal.findUnique({ where: { logicalKey: candidate.logicalKey } });
      if (!existing) {
        const signal = await transaction.strategicSignal.create({ data: {
          projectId: input.projectId,
          logicalKey: candidate.logicalKey,
          fingerprint: candidate.fingerprint,
          type: candidate.type,
          severity: candidate.severity,
          source: candidate.source,
          sourceId: candidate.sourceId,
          subject: candidate.subject,
          summary: candidate.summary,
          impact: candidate.impact,
          confidence: candidate.confidence,
          limitations: json(candidate.limitations),
          detectedAt: input.evaluatedAt,
          lastObservedAt: candidate.observedAt,
          cooldownUntil: input.cooldownUntil,
          evidence: { create: {
            snapshotId: input.snapshotId,
            source: candidate.source,
            sourceId: candidate.sourceId,
            kind: 'DETECTED',
            summary: candidate.evidence.join(' ') || candidate.summary,
            payload: json({ stateValue: candidate.stateValue, metadata: candidate.metadata ?? {}, ruleCode: candidate.ruleCode }),
            observedAt: candidate.observedAt,
          } },
        }, include: details });
        return { signal, created: true, changed: true };
      }

      const inactive = ['RESOLVED', 'DISMISSED'].includes(existing.state);
      const stale = existing.state === 'STALE';
      const cooldownActive = input.evaluatedAt < existing.cooldownUntil;
      if (existing.fingerprint === candidate.fingerprint && !stale && (!inactive || cooldownActive)) {
        const signal = await transaction.strategicSignal.update({
          where: { id: existing.id }, data: { lastObservedAt: candidate.observedAt }, include: details,
        });
        return { signal, created: false, changed: false };
      }

      const signal = await transaction.strategicSignal.update({ where: { id: existing.id }, data: {
        projectId: input.projectId,
        fingerprint: candidate.fingerprint,
        type: candidate.type,
        severity: candidate.severity,
        state: 'NEW',
        source: candidate.source,
        sourceId: candidate.sourceId,
        subject: candidate.subject,
        summary: candidate.summary,
        impact: candidate.impact,
        confidence: candidate.confidence,
        limitations: json(candidate.limitations),
        detectedAt: input.evaluatedAt,
        lastObservedAt: candidate.observedAt,
        cooldownUntil: input.cooldownUntil,
        acknowledgedAt: null,
        resolvedAt: null,
        dismissedAt: null,
        evidence: { create: {
          snapshotId: input.snapshotId,
          source: candidate.source,
          sourceId: candidate.sourceId,
          kind: inactive ? 'REOPENED' : 'CHANGED',
          summary: candidate.evidence.join(' ') || candidate.summary,
          payload: json({ previousFingerprint: existing.fingerprint, stateValue: candidate.stateValue,
            metadata: candidate.metadata ?? {}, ruleCode: candidate.ruleCode }),
          observedAt: candidate.observedAt,
        } },
      }, include: details });
      return { signal, created: false, changed: true };
    });
  }

  async resolveMissing(input: {
    projectId: string | null;
    activeLogicalKeys: string[];
    evaluatedSources: string[];
    snapshotId: string;
    evaluatedAt: Date;
    cooldownHours: number;
  }): Promise<number> {
    const rows = await this.client.strategicSignal.findMany({ where: {
      projectId: input.projectId,
      source: { in: input.evaluatedSources },
      state: { in: ['NEW', 'ACKNOWLEDGED', 'STALE'] },
      ...(input.activeLogicalKeys.length ? { logicalKey: { notIn: input.activeLogicalKeys } } : {}),
    } });
    for (const row of rows) {
      await this.client.strategicSignal.update({ where: { id: row.id }, data: {
        state: 'RESOLVED',
        resolvedAt: input.evaluatedAt,
        cooldownUntil: new Date(input.evaluatedAt.getTime() + input.cooldownHours * 3_600_000),
        evidence: { create: {
          snapshotId: input.snapshotId,
          source: row.source,
          sourceId: row.sourceId,
          kind: 'AUTO_RESOLVED',
          summary: 'O estado subjacente deixou de ser observado em uma avaliacao completa da mesma fonte.',
          payload: json({ previousState: row.state }),
          observedAt: input.evaluatedAt,
        } },
      } });
    }
    return rows.length;
  }

  async markSourcesStale(input: {
    projectId: string | null;
    sources: string[];
    snapshotId: string;
    evaluatedAt: Date;
  }): Promise<number> {
    if (!input.sources.length) return 0;
    const rows = await this.client.strategicSignal.findMany({ where: {
      projectId: input.projectId,
      source: { in: input.sources },
      state: { in: ['NEW', 'ACKNOWLEDGED'] },
    } });
    for (const row of rows) {
      await this.client.strategicSignal.update({ where: { id: row.id }, data: {
        state: 'STALE',
        evidence: { create: {
          snapshotId: input.snapshotId,
          source: row.source,
          sourceId: row.sourceId,
          kind: 'SOURCE_STALE',
          summary: 'A fonte nao concluiu esta avaliacao; o sinal anterior foi preservado como stale.',
          payload: json({ previousState: row.state }),
          observedAt: input.evaluatedAt,
        } },
      } });
    }
    return rows.length;
  }

  async transition(id: string, state: SignalState, reason: string | null, at: Date) {
    return this.client.$transaction(async (transaction) => {
      const existing = await transaction.strategicSignal.findUnique({ where: { id } });
      if (!existing) return null;
      if (existing.state === state) return transaction.strategicSignal.findUnique({ where: { id }, include: details });
      return transaction.strategicSignal.update({ where: { id }, data: {
        state,
        ...(state === 'ACKNOWLEDGED' ? { acknowledgedAt: at } : {}),
        ...(state === 'RESOLVED' ? { resolvedAt: at } : {}),
        ...(state === 'DISMISSED' ? { dismissedAt: at } : {}),
        evidence: { create: {
          source: 'USER', sourceId: id, kind: `STATE_${state}`,
          summary: reason ?? `Signal state changed to ${state}.`,
          payload: json({ previousState: existing.state, nextState: state }), observedAt: at,
        } },
      }, include: details });
    });
  }
}
