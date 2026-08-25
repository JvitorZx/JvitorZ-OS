import type { PrismaClient, VideoIdea } from '@prisma/client';
import { PrismaRepository } from './PrismaRepository';

export type CreateVideoIdeaData = Pick<VideoIdea, 'theme' | 'format' | 'premise'> &
  Partial<Pick<VideoIdea, 'projectId' | 'game' | 'estimatedEffort' | 'novelty' | 'identityFit'>>;

export class VideoIdeaRepository extends PrismaRepository<VideoIdea> {
  constructor(client: PrismaClient) {
    super(client, client.videoIdea);
  }

  async create(data: CreateVideoIdeaData): Promise<VideoIdea> {
    return this.delegate.create({ data });
  }

  async findAll(projectId?: string | null): Promise<VideoIdea[]> {
    return this.delegate.findMany({
      where: projectId === undefined ? undefined : { projectId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async findById(id: string): Promise<VideoIdea | null> {
    return this.delegate.findUnique({ where: { id } });
  }
}
