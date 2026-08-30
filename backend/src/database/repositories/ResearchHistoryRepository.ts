import type { Prisma, PrismaClient } from '@prisma/client';

export type ResearchHistoryWithOpportunities = Prisma.ResearchHistoryGetPayload<{
  include: { opportunities: true };
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
  }>;
}

const includeOpportunities = {
  opportunities: { orderBy: [{ rank: 'asc' }, { key: 'asc' }] },
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
