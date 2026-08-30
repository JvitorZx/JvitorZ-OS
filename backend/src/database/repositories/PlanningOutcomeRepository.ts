import type { PlanningOutcome, PlanningOutcomeLink, Prisma, PrismaClient } from '@prisma/client';

const linkDetails = {
  sourceSnapshot: true,
  executionEvent: true,
  outcomes: { include: { snapshot: true }, orderBy: [{ observedAt: 'desc' }, { id: 'asc' }] },
  auditEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.PlanningOutcomeLinkInclude;

export type PlanningOutcomeLinkWithDetails = Prisma.PlanningOutcomeLinkGetPayload<{ include: typeof linkDetails }>;
export type PlanningOutcomeWithDetails = Prisma.PlanningOutcomeGetPayload<{
  include: { snapshot: true; link: true; executionEvent: true; auditEvents: true };
}>;

export interface AssociatePlanningVideoData {
  projectId: string | null;
  planId: string;
  itemId: string;
  executionEventId: string;
  sourceSnapshotId: string;
  videoId: string;
  videoTitle: string;
  publishedAt: Date | null;
  reason: string | null;
  linkedAt: Date;
}

export interface SavePlanningOutcomeData {
  projectId: string | null;
  planId: string;
  itemId: string;
  executionEventId: string;
  linkId: string;
  snapshotId: string;
  videoId: string;
  observedAt: Date;
  windowStart: Date | null;
  windowEnd: Date | null;
  freshness: string;
  dataQuality: string;
  metrics: Prisma.InputJsonValue;
  benchmark: Prisma.InputJsonValue;
  comparison: Prisma.InputJsonValue;
  evidence: Prisma.InputJsonValue;
  classification: string;
  confidence: number;
  limitations: Prisma.InputJsonValue;
  missingData: Prisma.InputJsonValue;
  evaluatedAt: Date;
}

export class PlanningOutcomeRepository {
  constructor(private readonly client: PrismaClient) {}

  async findActiveLinkByItem(itemId: string): Promise<PlanningOutcomeLinkWithDetails | null> {
    return this.client.planningOutcomeLink.findFirst({ where: { itemId, activeItemKey: itemId }, include: linkDetails });
  }

  async findActiveLinkByVideo(videoId: string): Promise<PlanningOutcomeLinkWithDetails | null> {
    return this.client.planningOutcomeLink.findFirst({ where: { videoId, activeVideoKey: videoId }, include: linkDetails });
  }

  async associate(data: AssociatePlanningVideoData): Promise<{ link: PlanningOutcomeLinkWithDetails; created: boolean; replaced: boolean }> {
    return this.client.$transaction(async (transaction) => {
      const active = await transaction.planningOutcomeLink.findFirst({ where: { itemId: data.itemId, activeItemKey: data.itemId } });
      if (active?.videoId === data.videoId) {
        const link = await transaction.planningOutcomeLink.findUniqueOrThrow({ where: { id: active.id }, include: linkDetails });
        return { link, created: false, replaced: false };
      }
      if (active) {
        await transaction.planningOutcomeLink.update({ where: { id: active.id }, data: {
          activeItemKey: null, activeVideoKey: null, unlinkedAt: data.linkedAt,
          unlinkReason: data.reason ?? 'Video associado foi corrigido explicitamente.',
        } });
        await transaction.planningOutcomeAuditEvent.create({ data: {
          planId: data.planId, itemId: data.itemId, linkId: active.id, event: 'VIDEO_UNLINKED', reason: data.reason,
          data: { videoId: active.videoId, replaced: true }, createdAt: data.linkedAt,
        } });
      }
      const created = await transaction.planningOutcomeLink.create({ data: {
        projectId: data.projectId, planId: data.planId, itemId: data.itemId, executionEventId: data.executionEventId,
        sourceSnapshotId: data.sourceSnapshotId, videoId: data.videoId, videoTitle: data.videoTitle,
        publishedAt: data.publishedAt, activeItemKey: data.itemId, activeVideoKey: data.videoId, linkedAt: data.linkedAt,
      } });
      await transaction.planningOutcomeAuditEvent.create({ data: {
        planId: data.planId, itemId: data.itemId, linkId: created.id,
        event: active ? 'VIDEO_RELINKED' : 'VIDEO_LINKED', reason: data.reason,
        data: { videoId: data.videoId, sourceSnapshotId: data.sourceSnapshotId }, createdAt: data.linkedAt,
      } });
      const link = await transaction.planningOutcomeLink.findUniqueOrThrow({ where: { id: created.id }, include: linkDetails });
      return { link, created: true, replaced: Boolean(active) };
    });
  }

  async unlink(itemId: string, reason: string, occurredAt: Date): Promise<PlanningOutcomeLinkWithDetails | null> {
    return this.client.$transaction(async (transaction) => {
      const active = await transaction.planningOutcomeLink.findFirst({ where: { itemId, activeItemKey: itemId } });
      if (!active) return null;
      await transaction.planningOutcomeLink.update({ where: { id: active.id }, data: {
        activeItemKey: null, activeVideoKey: null, unlinkedAt: occurredAt, unlinkReason: reason,
      } });
      await transaction.planningOutcomeAuditEvent.create({ data: {
        planId: active.planId, itemId: active.itemId, linkId: active.id, event: 'VIDEO_UNLINKED', reason,
        data: { videoId: active.videoId, replaced: false }, createdAt: occurredAt,
      } });
      return transaction.planningOutcomeLink.findUnique({ where: { id: active.id }, include: linkDetails });
    });
  }

  async saveOutcome(data: SavePlanningOutcomeData): Promise<{ outcome: PlanningOutcome; created: boolean }> {
    return this.client.$transaction(async (transaction) => {
      const where = { linkId_snapshotId: { linkId: data.linkId, snapshotId: data.snapshotId } };
      const existing = await transaction.planningOutcome.findUnique({ where });
      if (existing) return { outcome: existing, created: false };
      const outcome = await transaction.planningOutcome.create({ data });
      await transaction.planningOutcomeAuditEvent.create({ data: {
        planId: data.planId, itemId: data.itemId, linkId: data.linkId, outcomeId: outcome.id,
        event: 'OUTCOME_CAPTURED', reason: null,
        data: { snapshotId: data.snapshotId, classification: data.classification, observedAt: data.observedAt.toISOString() },
        createdAt: data.evaluatedAt,
      } });
      return { outcome, created: true };
    });
  }

  async findOutcomeByLinkAndSnapshot(linkId: string, snapshotId: string): Promise<PlanningOutcome | null> {
    return this.client.planningOutcome.findUnique({ where: { linkId_snapshotId: { linkId, snapshotId } } });
  }

  async findOutcomeById(id: string): Promise<PlanningOutcomeWithDetails | null> {
    return this.client.planningOutcome.findUnique({ where: { id }, include: { snapshot: true, link: true, executionEvent: true, auditEvents: true } });
  }

  async findBundleByItem(itemId: string): Promise<{
    activeLink: PlanningOutcomeLinkWithDetails | null;
    links: PlanningOutcomeLinkWithDetails[];
    audit: Prisma.PlanningOutcomeAuditEventGetPayload<object>[];
  }> {
    const [activeLink, links, audit] = await Promise.all([
      this.findActiveLinkByItem(itemId),
      this.client.planningOutcomeLink.findMany({ where: { itemId }, include: linkDetails, orderBy: [{ linkedAt: 'desc' }, { id: 'asc' }] }),
      this.client.planningOutcomeAuditEvent.findMany({ where: { itemId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
    ]);
    return { activeLink, links, audit };
  }
}
