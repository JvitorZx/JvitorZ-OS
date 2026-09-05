import type { Prisma, PrismaClient } from '@prisma/client';

export type ResearchHistoryWithOpportunities = Prisma.ResearchHistoryGetPayload<{
  include: { opportunities: true };
}>;

export type ResearchSessionDetails = Prisma.ResearchHistoryGetPayload<{
  include: {
    opportunities: true;
    evidenceItems: true;
    events: true;
    contentGaps: true;
    ideas: true;
  };
}>;

export interface CreateResearchHistoryData {
  projectId: string | null;
  executionKey: string;
  cacheKey: string;
  query: string;
  normalizedQuery: string;
  intent: string;
  subjectType: string | null;
  subject: string | null;
  sources: Prisma.InputJsonValue;
  results: Prisma.InputJsonValue;
  quality: string;
  freshness: string;
  limitations: Prisma.InputJsonValue;
  context: Prisma.InputJsonValue;
  researchedAt: Date;
  validUntil: Date;
  status?: string;
  objective?: string | null;
  format?: string | null;
  game?: string | null;
  constraints?: Prisma.InputJsonValue;
  runVersion?: number;
  startedAt?: Date | null;
  completedAt?: Date | null;
  opportunities: Array<{
    key: string;
    rank: number;
    subject: string;
    subjectType: string;
    state: string;
    summary: string;
    sources: Prisma.InputJsonValue;
    evidence: Prisma.InputJsonValue;
    freshness: string;
    compatibility: number;
    confidence: number;
    risks: Prisma.InputJsonValue;
    gaps: Prisma.InputJsonValue;
    nextInvestigation: string;
    candidateStatus?: string;
    effort?: string;
    novelty?: number | null;
    saturation?: number | null;
    qualityGate?: string;
    scoreDetails?: Prisma.InputJsonValue;
  }>;
}

const includeOpportunities = {
  opportunities: { orderBy: [{ rank: 'asc' }, { key: 'asc' }] },
} satisfies Prisma.ResearchHistoryInclude;

const includeSession = {
  opportunities: { orderBy: [{ rank: 'asc' }, { key: 'asc' }] },
  evidenceItems: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
  contentGaps: { orderBy: [{ relevance: 'desc' }, { id: 'asc' }] },
  ideas: { orderBy: [{ opportunityScore: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ResearchHistoryInclude;

export class ResearchHistoryRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(data: CreateResearchHistoryData): Promise<ResearchHistoryWithOpportunities> {
    const { opportunities, ...history } = data;
    return this.client.researchHistory.create({
      data: { ...history, opportunities: { create: opportunities } },
      include: includeOpportunities,
    });
  }

  async createSession(data: Omit<CreateResearchHistoryData, 'opportunities'> & {
    eventAt: Date;
  }): Promise<ResearchSessionDetails> {
    const { eventAt, ...history } = data;
    return this.client.researchHistory.create({
      data: {
        ...history,
        events: { create: { event: 'SESSION_CREATED', occurredAt: eventAt } },
      },
      include: includeSession,
    });
  }

  async claimRun(id: string, now: Date): Promise<boolean> {
    const result = await this.client.researchHistory.updateMany({
      where: { id, status: 'DRAFT' },
      data: { status: 'RUNNING', startedAt: now },
    });
    if (!result.count) return false;
    await this.client.researchSessionEvent.create({
      data: { researchHistoryId: id, event: 'SESSION_RUN_STARTED', occurredAt: now },
    });
    return true;
  }

  async completeSession(data: {
    id: string;
    sources: Prisma.InputJsonValue;
    results: Prisma.InputJsonValue;
    quality: string;
    freshness: string;
    limitations: Prisma.InputJsonValue;
    context: Prisma.InputJsonValue;
    researchedAt: Date;
    validUntil: Date;
    opportunities: CreateResearchHistoryData['opportunities'];
    evidence: Array<Prisma.ResearchEvidenceItemUncheckedCreateWithoutResearchHistoryInput>;
    gaps: Array<Prisma.ResearchContentGapUncheckedCreateWithoutResearchHistoryInput>;
  }): Promise<ResearchSessionDetails> {
    const { id, opportunities, evidence, gaps, ...values } = data;
    return this.client.$transaction(async (transaction) => {
      await transaction.researchOpportunity.deleteMany({ where: { researchHistoryId: id } });
      await transaction.researchEvidenceItem.deleteMany({ where: { researchHistoryId: id } });
      await transaction.researchContentGap.deleteMany({ where: { researchHistoryId: id } });
      await transaction.researchHistory.update({
        where: { id },
        data: {
          ...values,
          status: 'COMPLETED',
          completedAt: values.researchedAt,
          opportunities: { create: opportunities },
          evidenceItems: { create: evidence },
          contentGaps: { create: gaps },
        },
      });
      await transaction.researchSessionEvent.create({
        data: { researchHistoryId: id, event: 'SESSION_RUN_COMPLETED', occurredAt: values.researchedAt,
          data: { opportunityCount: opportunities.length, evidenceCount: evidence.length, gapCount: gaps.length } },
      });
      return transaction.researchHistory.findUniqueOrThrow({ where: { id }, include: includeSession });
    });
  }

  async failSession(id: string, now: Date, errorType: string): Promise<void> {
    await this.client.$transaction([
      this.client.researchHistory.update({ where: { id }, data: { status: 'FAILED', completedAt: now } }),
      this.client.researchSessionEvent.create({ data: { researchHistoryId: id, event: 'SESSION_RUN_FAILED', occurredAt: now, data: { errorType } } }),
    ]);
  }

  async archiveSession(id: string, now: Date): Promise<ResearchSessionDetails> {
    await this.client.$transaction([
      this.client.researchHistory.update({ where: { id }, data: { status: 'ARCHIVED', archivedAt: now } }),
      this.client.researchSessionEvent.create({ data: { researchHistoryId: id, event: 'SESSION_ARCHIVED', occurredAt: now } }),
    ]);
    return this.client.researchHistory.findUniqueOrThrow({ where: { id }, include: includeSession });
  }

  async addEvent(id: string, event: string, now: Date, data?: Prisma.InputJsonValue, reason?: string | null): Promise<void> {
    await this.client.researchSessionEvent.create({
      data: { researchHistoryId: id, event, occurredAt: now, data, reason: reason ?? null },
    });
  }

  async findSessionById(id: string): Promise<ResearchSessionDetails | null> {
    return this.client.researchHistory.findUnique({ where: { id }, include: includeSession });
  }

  async findSessions(filters: { projectId?: string | null; status?: string; limit?: number } = {}): Promise<ResearchSessionDetails[]> {
    const where: Prisma.ResearchHistoryWhereInput = {};
    if ('projectId' in filters) where.projectId = filters.projectId;
    if (filters.status) where.status = filters.status;
    return this.client.researchHistory.findMany({
      where, include: includeSession,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: filters.limit ?? 20,
    });
  }

  async findFresh(cacheKey: string, now: Date): Promise<ResearchHistoryWithOpportunities | null> {
    return this.client.researchHistory.findFirst({
      where: { cacheKey, validUntil: { gt: now }, quality: { notIn: ['ERROR', 'MISSING'] } },
      include: includeOpportunities,
      orderBy: [{ researchedAt: 'desc' }, { id: 'asc' }],
    });
  }

  async findLatest(cacheKey: string): Promise<ResearchHistoryWithOpportunities | null> {
    return this.client.researchHistory.findFirst({
      where: { cacheKey, quality: { notIn: ['ERROR', 'MISSING'] } },
      include: includeOpportunities,
      orderBy: [{ researchedAt: 'desc' }, { id: 'asc' }],
    });
  }

  async findByExecutionKey(executionKey: string): Promise<ResearchHistoryWithOpportunities | null> {
    return this.client.researchHistory.findUnique({ where: { executionKey }, include: includeOpportunities });
  }

  async findById(id: string): Promise<ResearchHistoryWithOpportunities | null> {
    return this.client.researchHistory.findUnique({ where: { id }, include: includeOpportunities });
  }

  async findAll(filters: { projectId?: string | null; limit?: number } = {}): Promise<ResearchHistoryWithOpportunities[]> {
    return this.client.researchHistory.findMany({
      where: 'projectId' in filters ? { projectId: filters.projectId } : undefined,
      include: includeOpportunities,
      orderBy: [{ researchedAt: 'desc' }, { id: 'asc' }],
      take: filters.limit ?? 20,
    });
  }
}
