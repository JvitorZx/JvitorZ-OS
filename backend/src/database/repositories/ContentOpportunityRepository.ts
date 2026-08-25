import type { ContentOpportunity, PrismaClient } from '@prisma/client';
import { PrismaRepository } from './PrismaRepository';

export type CreateContentOpportunityData = Omit<ContentOpportunity, 'id' | 'createdAt'>;

export class ContentOpportunityRepository extends PrismaRepository<ContentOpportunity> {
  constructor(client: PrismaClient) {
    super(client, client.contentOpportunity);
  }

  async create(data: CreateContentOpportunityData): Promise<ContentOpportunity> {
    return this.delegate.create({ data });
  }

  async findAll(): Promise<ContentOpportunity[]> {
    return this.delegate.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async findByIdeaId(videoIdeaId: string): Promise<ContentOpportunity[]> {
    return this.delegate.findMany({
      where: { videoIdeaId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }
}
