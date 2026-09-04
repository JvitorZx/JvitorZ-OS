import type { Prisma, PrismaClient } from '@prisma/client';

const details = {
  variants: { orderBy: [{ createdAt: 'asc' as const }, { key: 'asc' as const }], include: { metricSnapshots: { orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }] } } },
  history: { orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }] },
  experiments: { orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }] },
} satisfies Prisma.ContentPackagingInclude;

export type ContentPackagingDetails = Prisma.ContentPackagingGetPayload<{ include: typeof details }>;

export class PackagingRepository {
  constructor(private readonly client: PrismaClient) {}

  create(data: Prisma.ContentPackagingUncheckedCreateInput): Promise<ContentPackagingDetails> {
    return this.client.contentPackaging.create({ data, include: details });
  }

  findById(id: string): Promise<ContentPackagingDetails | null> {
    return this.client.contentPackaging.findUnique({ where: { id }, include: details });
  }

  findAll(filters: { projectId?: string | null; game?: string; series?: string; status?: string; limit?: number } = {}): Promise<ContentPackagingDetails[]> {
    return this.client.contentPackaging.findMany({
      where: {
        ...('projectId' in filters ? { projectId: filters.projectId } : {}),
        ...(filters.game ? { game: filters.game } : {}), ...(filters.series ? { series: filters.series } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      include: details, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: filters.limit ?? 100,
    });
  }

  findVariant(id: string) {
    return this.client.packagingVariant.findUnique({ where: { id }, include: { packaging: true, metricSnapshots: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] } } });
  }

  async updateVariant(id: string, data: Prisma.PackagingVariantUncheckedUpdateInput, reason?: string) {
    return this.client.$transaction(async (transaction) => {
      const variant = await transaction.packagingVariant.update({ where: { id }, data });
      await transaction.packagingHistory.create({ data: { packagingId: variant.packagingId, variantId: id, event: 'EDITED', reason: reason ?? null, data: { fields: Object.keys(data) } } });
      return transaction.contentPackaging.findUniqueOrThrow({ where: { id: variant.packagingId }, include: details });
    });
  }

  async selectVariant(id: string, reason?: string) {
    return this.client.$transaction(async (transaction) => {
      const selected = await transaction.packagingVariant.findUnique({ where: { id } });
      if (!selected) return null;
      await transaction.packagingVariant.updateMany({ where: { packagingId: selected.packagingId, status: 'SELECTED' }, data: { status: 'DRAFT', selectedAt: null } });
      await transaction.packagingVariant.update({ where: { id }, data: { status: 'SELECTED', selectedAt: new Date() } });
      await transaction.contentPackaging.update({ where: { id: selected.packagingId }, data: { status: 'SELECTED' } });
      await transaction.packagingHistory.create({ data: { packagingId: selected.packagingId, variantId: id, event: 'SELECTED', reason: reason ?? null, data: {} } });
      return transaction.contentPackaging.findUniqueOrThrow({ where: { id: selected.packagingId }, include: details });
    });
  }

  async rejectVariant(id: string, reason?: string) {
    return this.client.$transaction(async (transaction) => {
      const variant = await transaction.packagingVariant.update({ where: { id }, data: { status: 'REJECTED' } });
      await transaction.packagingHistory.create({ data: { packagingId: variant.packagingId, variantId: id, event: 'REJECTED', reason: reason ?? null, data: {} } });
      return transaction.contentPackaging.findUniqueOrThrow({ where: { id: variant.packagingId }, include: details });
    });
  }

  async publishVariant(id: string, videoId: string, publishedAt: Date) {
    return this.client.$transaction(async (transaction) => {
      const variant = await transaction.packagingVariant.update({ where: { id }, data: { status: 'PUBLISHED', publishedVideoId: videoId, publishedAt } });
      await transaction.contentPackaging.update({ where: { id: variant.packagingId }, data: { status: 'PUBLISHED', videoId } });
      await transaction.packagingHistory.create({ data: { packagingId: variant.packagingId, variantId: id, event: 'PUBLISHED', data: { videoId, publishedAt: publishedAt.toISOString() } } });
      return transaction.contentPackaging.findUniqueOrThrow({ where: { id: variant.packagingId }, include: details });
    });
  }

  async saveMetric(data: Prisma.PackagingMetricSnapshotUncheckedCreateInput) {
    const existing = await this.client.packagingMetricSnapshot.findUnique({ where: { ingestionKey: data.ingestionKey } });
    if (existing) return { snapshot: existing, created: false };
    try { return { snapshot: await this.client.packagingMetricSnapshot.create({ data }), created: true }; }
    catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') throw error;
      return { snapshot: await this.client.packagingMetricSnapshot.findUniqueOrThrow({ where: { ingestionKey: data.ingestionKey } }), created: false };
    }
  }

  async createExperiment(data: Prisma.PackagingExperimentUncheckedCreateInput) {
    const experiment = await this.client.packagingExperiment.create({ data });
    await this.client.packagingHistory.create({ data: { packagingId: experiment.packagingId, event: 'EXPERIMENT_CREATED', data: { experimentId: experiment.id } } });
    return experiment;
  }
}
