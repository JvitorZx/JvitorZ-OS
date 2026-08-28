import type { Prisma, PrismaClient, SeriesDefinition } from '@prisma/client';

export type SaveSeriesDefinitionData = Omit<Prisma.SeriesDefinitionUncheckedCreateInput, 'id' | 'createdAt' | 'updatedAt'>;
export type SaveVideoSeriesLinkData = Omit<Prisma.VideoSeriesLinkUncheckedCreateInput, 'id' | 'createdAt' | 'updatedAt'>;
export type SeriesWithLinks = Prisma.SeriesDefinitionGetPayload<{ include: { videoLinks: { include: { sourceSnapshot: true } } } }>;

const includeLinks = {
  videoLinks: { include: { sourceSnapshot: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] },
} satisfies Prisma.SeriesDefinitionInclude;

export class SeriesDefinitionRepository {
  constructor(private readonly client: PrismaClient) {}

  async upsert(data: SaveSeriesDefinitionData): Promise<{ series: SeriesDefinition; created: boolean }> {
    const existing = await this.client.seriesDefinition.findUnique({ where: { key: data.key } });
    const { key, ...values } = data;
    const series = await this.client.seriesDefinition.upsert({ where: { key }, create: { key, ...values }, update: values });
    return { series, created: existing === null };
  }

  async findAll(projectId?: string | null): Promise<SeriesWithLinks[]> {
    return this.client.seriesDefinition.findMany({
      where: projectId === undefined ? undefined : { projectId }, include: includeLinks,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    });
  }

  async findById(id: string): Promise<SeriesWithLinks | null> {
    return this.client.seriesDefinition.findUnique({ where: { id }, include: includeLinks });
  }

  async findByKey(key: string): Promise<SeriesWithLinks | null> {
    return this.client.seriesDefinition.findUnique({ where: { key }, include: includeLinks });
  }

  async findByNormalizedKey(normalizedKey: string, projectId: string | null): Promise<SeriesWithLinks | null> {
    return this.client.seriesDefinition.findFirst({ where: { projectId, normalizedKey }, include: includeLinks, orderBy: { id: 'asc' } });
  }

  async upsertVideoLink(data: SaveVideoSeriesLinkData) {
    const where = { seriesId_videoId: { seriesId: data.seriesId, videoId: data.videoId } };
    const existing = await this.client.videoSeriesLink.findUnique({ where });
    const link = await this.client.videoSeriesLink.upsert({ where, create: data, update: data });
    return { link, created: existing === null };
  }

  async deleteVideoLink(seriesId: string, videoId: string): Promise<boolean> {
    const result = await this.client.videoSeriesLink.deleteMany({ where: { seriesId, videoId } });
    return result.count > 0;
  }

  async findLinksByVideo(videoId: string) {
    return this.client.videoSeriesLink.findMany({ where: { videoId }, include: { series: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
  }
}
