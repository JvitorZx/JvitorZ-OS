import type { PlannedContentItem, Prisma, PrismaClient } from '@prisma/client';

export type PlannedContentItemWithPlan = Prisma.PlannedContentItemGetPayload<{ include: { plan: true } }>;

export interface CreatePlannedContentItemData {
  planId: string;
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
}

export class PlannedContentItemRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(data: CreatePlannedContentItemData, reason: string): Promise<PlannedContentItem> {
    return this.client.$transaction(async (transaction) => {
      const item = await transaction.plannedContentItem.create({ data });
      await transaction.planningHistory.create({
        data: { planId: data.planId, itemId: item.id, event: 'ITEM_ADDED', reason, after: item as unknown as Prisma.InputJsonValue },
      });
      return item;
    });
  }

  async findById(id: string): Promise<PlannedContentItemWithPlan | null> {
    return this.client.plannedContentItem.findUnique({ where: { id }, include: { plan: true } });
  }

  async updateWithHistory(
    id: string,
    data: Prisma.PlannedContentItemUpdateInput,
    event: string,
    reason: string,
  ): Promise<PlannedContentItem> {
    return this.client.$transaction(async (transaction) => {
      const before = await transaction.plannedContentItem.findUniqueOrThrow({ where: { id } });
      const item = await transaction.plannedContentItem.update({ where: { id }, data });
      await transaction.planningHistory.create({
        data: {
          planId: item.planId, itemId: item.id, event, reason,
          before: before as unknown as Prisma.InputJsonValue,
          after: item as unknown as Prisma.InputJsonValue,
        },
      });
      return item;
    });
  }

  async reorder(planId: string, ordered: ReadonlyArray<{ id: string; queue: string }>, reason: string): Promise<PlannedContentItem[]> {
    return this.client.$transaction(async (transaction) => {
      const before = await transaction.plannedContentItem.findMany({ where: { planId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
      for (const [index, item] of ordered.entries()) {
        await transaction.plannedContentItem.update({ where: { id: item.id }, data: { position: index + 1, queue: item.queue } });
      }
      const items = await transaction.plannedContentItem.findMany({ where: { planId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
      await transaction.planningHistory.create({
        data: {
          planId, event: 'REORDERED', reason,
          before: before.map(({ id, position }) => ({ id, position })) as Prisma.InputJsonValue,
          after: items.map(({ id, position }) => ({ id, position })) as Prisma.InputJsonValue,
        },
      });
      return items;
    });
  }
}
