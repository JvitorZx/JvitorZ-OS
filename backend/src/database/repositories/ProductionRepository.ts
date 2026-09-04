import type { Prisma, PrismaClient } from '@prisma/client';

const details = {
  steps: { orderBy: [{ position: 'asc' as const }, { key: 'asc' as const }] },
  events: { orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }] },
  assets: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }], include: { libraryItem: true } },
  packaging: { include: { variants: { orderBy: [{ createdAt: 'asc' as const }, { key: 'asc' as const }] } } },
  seriesDefinition: true,
  plannedContentItem: true,
  transcripts: { orderBy: [{ version: 'desc' as const }], include: { segments: { orderBy: [{ position: 'asc' as const }] } } },
  chapterSets: { orderBy: [{ version: 'desc' as const }], include: { entries: { orderBy: [{ position: 'asc' as const }] } } },
} satisfies Prisma.ContentProductionInclude;

export type ContentProductionDetails = Prisma.ContentProductionGetPayload<{ include: typeof details }>;

export class ProductionRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(data: Prisma.ContentProductionUncheckedCreateInput): Promise<{ production: ContentProductionDetails; created: boolean }> {
    const existing = await this.client.contentProduction.findUnique({ where: { productionKey: data.productionKey }, include: details });
    if (existing) return { production: existing, created: false };
    try { return { production: await this.client.contentProduction.create({ data, include: details }), created: true }; }
    catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') throw error;
      return { production: await this.client.contentProduction.findUniqueOrThrow({ where: { productionKey: data.productionKey }, include: details }), created: false };
    }
  }

  findAll(filters: { projectId?: string | null; status?: string; format?: string; limit?: number } = {}): Promise<ContentProductionDetails[]> {
    return this.client.contentProduction.findMany({ where: {
      ...('projectId' in filters ? { projectId: filters.projectId } : {}), ...(filters.status ? { status: filters.status } : {}), ...(filters.format ? { format: filters.format } : {}),
    }, include: details, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: filters.limit ?? 100 });
  }

  findById(id: string): Promise<ContentProductionDetails | null> { return this.client.contentProduction.findUnique({ where: { id }, include: details }); }
  findByPlannedItem(id: string): Promise<ContentProductionDetails | null> { return this.client.contentProduction.findUnique({ where: { plannedContentItemId: id }, include: details }); }
  findLatest(projectId?: string | null): Promise<ContentProductionDetails | null> { return this.client.contentProduction.findFirst({ where: projectId === undefined ? {} : { projectId }, include: details, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }] }); }

  async references(input: { plannedContentItemId?: string | null; videoIdeaId?: string | null; seriesId?: string | null; libraryItemId?: string | null; packagingId?: string | null }) {
    const [planned, idea, series, library, packaging] = await Promise.all([
      input.plannedContentItemId ? this.client.plannedContentItem.findUnique({ where: { id: input.plannedContentItemId } }) : null,
      input.videoIdeaId ? this.client.videoIdea.findUnique({ where: { id: input.videoIdeaId } }) : null,
      input.seriesId ? this.client.seriesDefinition.findUnique({ where: { id: input.seriesId } }) : null,
      input.libraryItemId ? this.client.libraryItem.findUnique({ where: { id: input.libraryItemId } }) : null,
      input.packagingId ? this.client.contentPackaging.findUnique({ where: { id: input.packagingId }, include: { variants: true } }) : null,
    ]);
    return { planned, idea, series, library, packaging };
  }

  async updateMetadata(id: string, data: Prisma.ContentProductionUncheckedUpdateInput, invalidatedKeys: string[], reason: string, now: Date) {
    await this.client.$transaction(async (transaction) => {
      const before = await transaction.contentProduction.findUniqueOrThrow({ where: { id } });
      await transaction.contentProduction.update({ where: { id }, data });
      if (invalidatedKeys.length) await transaction.productionStep.updateMany({ where: { productionId: id, key: { in: invalidatedKeys }, state: { in: ['COMPLETED', 'WAITING_USER', 'IN_PROGRESS'] } }, data: { state: 'OUTDATED', invalidatedAt: now } });
      await transaction.productionEvent.create({ data: { productionId: id, event: 'METADATA_UPDATED', actor: 'user', origin: 'production-api', fromState: before.status, toState: before.status, reason, data: { invalidatedKeys } } });
    });
    return this.findById(id);
  }

  async transitionStep(input: { productionId: string; stepKey: string; allowedStates: string[]; state: string; event: string; actor: string; origin: string; reason?: string | null; executionKey?: string | null; data?: Prisma.InputJsonValue; input?: Prisma.InputJsonValue; output?: Prisma.InputJsonValue; error?: string | null; now: Date }) {
    return this.client.$transaction(async (transaction) => {
      const step = await transaction.productionStep.findUniqueOrThrow({ where: { productionId_key: { productionId: input.productionId, key: input.stepKey } } });
      if (step.state === input.state && ['IN_PROGRESS', 'WAITING_USER', 'COMPLETED', 'SKIPPED', 'CANCELLED'].includes(input.state)) return transaction.contentProduction.findUniqueOrThrow({ where: { id: input.productionId }, include: details });
      const changed = await transaction.productionStep.updateMany({ where: { id: step.id, state: { in: input.allowedStates } }, data: {
        state: input.state, ...(input.state === 'IN_PROGRESS' ? { attempts: { increment: 1 }, startedAt: step.startedAt ?? input.now, completedAt: null, error: null, executionKey: input.executionKey ?? step.executionKey } : {}),
        ...(input.state === 'COMPLETED' ? { completedAt: input.now, error: null } : {}), ...(input.state === 'SKIPPED' ? { completedAt: input.now, skipReason: input.reason ?? null } : {}),
        ...(input.state === 'FAILED' ? { error: input.error ?? 'Step failed' } : {}), ...(input.input !== undefined ? { input: input.input } : {}), ...(input.output !== undefined ? { output: input.output } : {}),
        ...(input.state === 'AVAILABLE' ? { completedAt: null, startedAt: null, error: null, skipReason: null, executionKey: null } : {}),
        ...(input.state !== 'OUTDATED' ? { invalidatedAt: null } : {}),
      } });
      if (!changed.count) throw new Error('PRODUCTION_TRANSITION_CONFLICT');
      try { await transaction.productionEvent.create({ data: { productionId: input.productionId, stepKey: input.stepKey, event: input.event, actor: input.actor, origin: input.origin, fromState: step.state, toState: input.state, reason: input.reason ?? null, operationKey: input.executionKey ?? null, data: input.data ?? {} } }); }
      catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') throw error; }
      return transaction.contentProduction.findUniqueOrThrow({ where: { id: input.productionId }, include: details });
    });
  }

  async setStepAvailable(productionId: string, keys: string[]) {
    if (keys.length) await this.client.productionStep.updateMany({ where: { productionId, key: { in: keys }, state: 'NOT_STARTED' }, data: { state: 'AVAILABLE' } });
  }

  async updateProduction(id: string, data: Prisma.ContentProductionUncheckedUpdateInput, event?: { event: string; actor: string; origin: string; reason?: string; data?: Prisma.InputJsonValue }) {
    await this.client.$transaction(async (transaction) => {
      const before = await transaction.contentProduction.findUniqueOrThrow({ where: { id } });
      await transaction.contentProduction.update({ where: { id }, data });
      if (event) await transaction.productionEvent.create({ data: { productionId: id, event: event.event, actor: event.actor, origin: event.origin, fromState: before.status, toState: typeof data.status === 'string' ? data.status : before.status, reason: event.reason ?? null, data: event.data ?? {} } });
    });
    return this.findById(id);
  }

  async linkAsset(productionId: string, libraryItemId: string, role: string) {
    await this.client.$transaction(async (transaction) => {
      const existing = await transaction.productionAssetRelation.findUnique({ where: { productionId_libraryItemId_role: { productionId, libraryItemId, role } } });
      if (!existing) { await transaction.productionAssetRelation.create({ data: { productionId, libraryItemId, role } }); await transaction.productionEvent.create({ data: { productionId, event: 'ASSET_LINKED', actor: 'user', origin: 'production-api', data: { libraryItemId, role } } }); }
    });
    return this.findById(productionId);
  }

  async unlinkAsset(productionId: string, relationId: string) {
    await this.client.$transaction(async (transaction) => { const relation = await transaction.productionAssetRelation.findFirst({ where: { id: relationId, productionId } }); if (relation) { await transaction.productionAssetRelation.delete({ where: { id: relation.id } }); await transaction.productionEvent.create({ data: { productionId, event: 'ASSET_UNLINKED', actor: 'user', origin: 'production-api', data: { libraryItemId: relation.libraryItemId, role: relation.role } } }); } });
    return this.findById(productionId);
  }
}
