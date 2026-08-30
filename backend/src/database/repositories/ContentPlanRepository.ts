import type { Prisma, PrismaClient } from '@prisma/client';

export type ContentPlanWithItems = Prisma.ContentPlanGetPayload<{
  include: { items: true; history: true };
}>;

export interface CreateContentPlanData {
  projectId: string | null;
  horizon: string;
  status: string;
  summary: string;
  balance: Prisma.InputJsonValue;
  constraints: Prisma.InputJsonValue;
  risks: Prisma.InputJsonValue;
  source: Prisma.InputJsonValue;
  generatedAt: Date;
  items: Array<{
    sourceDecisionId: string | null;
    sourceResearchOpportunityId: string | null;
    researchHistoryId: string | null;
    seriesId: string | null;
    candidateKey: string;
    candidateType: string;
    title: string;
    rationale: string;
    status: string;
    priority: string;
    effort: string;
    readiness: string;
    queue: string;
    position: number;
    executionScore: number;
    manualPriority: boolean;
    evidence: Prisma.InputJsonValue;
    risks: Prisma.InputJsonValue;
    constraints: Prisma.InputJsonValue;
    missingData: Prisma.InputJsonValue;
    dependencies: Prisma.InputJsonValue;
    executionState: string;
    executionAction: string;
    executionConfidence: number | null;
    executionContext: Prisma.InputJsonValue;
  }>;
}

const includePlan = {
  items: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
  history: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ContentPlanInclude;

export class ContentPlanRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(data: CreateContentPlanData): Promise<ContentPlanWithItems> {
    const { items, ...plan } = data;
    return this.client.contentPlan.create({
      data: {
        ...plan,
        items: { create: items },
        history: {
          create: {
            event: 'GENERATED',
            reason: 'Plano gerado a partir das evidencias disponiveis.',
            after: { horizon: data.horizon, status: data.status, items: items.length },
          },
        },
      },
      include: includePlan,
    });
  }

  async findCurrent(filters: { projectId?: string | null; horizon?: string } = {}): Promise<ContentPlanWithItems | null> {
    return this.client.contentPlan.findFirst({
      where: {
        ...('projectId' in filters ? { projectId: filters.projectId } : {}),
        ...(filters.horizon ? { horizon: filters.horizon } : {}),
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      include: includePlan,
      orderBy: [{ generatedAt: 'desc' }, { id: 'asc' }],
    });
  }

  async findById(id: string): Promise<ContentPlanWithItems | null> {
    return this.client.contentPlan.findUnique({ where: { id }, include: includePlan });
  }

  async findAll(filters: { projectId?: string | null; limit?: number } = {}): Promise<ContentPlanWithItems[]> {
    return this.client.contentPlan.findMany({
      where: 'projectId' in filters ? { projectId: filters.projectId } : undefined,
      include: includePlan,
      orderBy: [{ generatedAt: 'desc' }, { id: 'asc' }],
      take: filters.limit ?? 20,
    });
  }

  async updateStatus(id: string, status: string): Promise<ContentPlanWithItems> {
    return this.client.contentPlan.update({ where: { id }, data: { status }, include: includePlan });
  }
}
