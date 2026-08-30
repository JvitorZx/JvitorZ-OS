import type { EditorialDecision, Prisma, PrismaClient } from '@prisma/client';

export interface CreateEditorialDecisionData {
  projectId: string | null;
  conversationId: string | null;
  dedupeKey: string;
  question: string;
  intent: string;
  recommendation: string;
  alternatives: Prisma.InputJsonValue;
  score: number | null;
  confidence: number;
  classification: string;
  category: string;
  candidateType: string | null;
  candidateKey: string | null;
  opportunityScore: Prisma.InputJsonValue;
  favorableEvidence: Prisma.InputJsonValue;
  contraryEvidence: Prisma.InputJsonValue;
  constraints: Prisma.InputJsonValue;
  evidence: Prisma.InputJsonValue;
  risks: Prisma.InputJsonValue;
  missingData: Prisma.InputJsonValue;
  nextAction: string;
}

export class EditorialDecisionRepository {
  private readonly delegate: PrismaClient['editorialDecision'];

  constructor(client: PrismaClient) {
    this.delegate = client.editorialDecision;
  }

  async create(data: CreateEditorialDecisionData): Promise<EditorialDecision> {
    return this.delegate.create({ data });
  }

  async findById(id: string): Promise<EditorialDecision | null> {
    return this.delegate.findUnique({ where: { id } });
  }

  async findByDedupeKey(dedupeKey: string): Promise<EditorialDecision | null> {
    return this.delegate.findUnique({ where: { dedupeKey } });
  }

  async findAll(filters: {
    projectId?: string | null;
    conversationId?: string | null;
    categories?: string[];
    candidateType?: string;
    candidateKey?: string;
    limit?: number;
  } = {}): Promise<EditorialDecision[]> {
    const where: Prisma.EditorialDecisionWhereInput = {};
    if ('projectId' in filters) where.projectId = filters.projectId;
    if ('conversationId' in filters) where.conversationId = filters.conversationId;
    if (filters.categories?.length) where.category = { in: filters.categories };
    if (filters.candidateType) where.candidateType = filters.candidateType;
    if (filters.candidateKey) where.candidateKey = filters.candidateKey;
    return this.delegate.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filters.limit ?? 20,
    });
  }

  async attachOperatorMessage(id: string, operatorMessageId: string): Promise<EditorialDecision> {
    return this.delegate.update({ where: { id }, data: { operatorMessageId } });
  }

  async registerOutcome(
    id: string,
    outcomeSnapshotId: string,
    outcome: Prisma.InputJsonValue,
  ): Promise<EditorialDecision> {
    return this.delegate.update({ where: { id }, data: { outcomeSnapshotId, outcome } });
  }
}
