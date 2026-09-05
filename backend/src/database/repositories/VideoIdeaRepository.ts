import type { Prisma, PrismaClient, VideoIdea } from '@prisma/client';
import { PrismaRepository } from './PrismaRepository';

export type CreateVideoIdeaData = VideoIdea | Omit<Prisma.VideoIdeaUncheckedCreateInput, 'id' | 'createdAt' | 'updatedAt'>;

export class VideoIdeaRepository extends PrismaRepository<VideoIdea> {
  constructor(client: PrismaClient) {
    super(client, client.videoIdea);
  }

  async create(data: CreateVideoIdeaData): Promise<VideoIdea> {
    return this.delegate.create({ data: data as Prisma.VideoIdeaUncheckedCreateInput });
  }

  async findAll(projectId?: string | null): Promise<VideoIdea[]> {
    return this.delegate.findMany({
      where: projectId === undefined ? undefined : { projectId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async findAllFiltered(filters: { projectId?: string | null; status?: string; researchHistoryId?: string; limit?: number } = {}): Promise<VideoIdea[]> {
    const where: Prisma.VideoIdeaWhereInput = {};
    if ('projectId' in filters) where.projectId = filters.projectId;
    if (filters.status) where.status = filters.status;
    if (filters.researchHistoryId) where.sourceResearchHistoryId = filters.researchHistoryId;
    return this.delegate.findMany({ where, orderBy: [{ opportunityScore: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }], take: filters.limit ?? 50 });
  }

  async findById(id: string): Promise<VideoIdea | null> {
    return this.delegate.findUnique({ where: { id } });
  }

  async findByKey(ideaKey: string): Promise<VideoIdea | null> {
    return this.delegate.findUnique({ where: { ideaKey } });
  }

  async update(id: string, data: Partial<VideoIdea> | Prisma.VideoIdeaUpdateInput): Promise<VideoIdea> {
    return this.delegate.update({ where: { id }, data: data as Prisma.VideoIdeaUpdateInput });
  }
}
