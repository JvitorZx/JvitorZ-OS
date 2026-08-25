import type { ContentDecision, Prisma, PrismaClient } from '@prisma/client';

export interface CreateContentDecisionData {
  videoIdeaId: string;
  category: string;
  score: number;
  rationale: string;
  evidence: Prisma.InputJsonValue;
}

export class ContentDecisionRepository {
  private readonly delegate: PrismaClient['contentDecision'];

  constructor(client: PrismaClient) {
    this.delegate = client.contentDecision;
  }

  async create(data: CreateContentDecisionData): Promise<ContentDecision> {
    return this.delegate.create({ data });
  }

  async findAll(): Promise<ContentDecision[]> {
    return this.delegate.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async findByIdeaId(videoIdeaId: string): Promise<ContentDecision[]> {
    return this.delegate.findMany({
      where: { videoIdeaId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async findById(id: string): Promise<ContentDecision | null> {
    return this.delegate.findUnique({ where: { id } });
  }
}
