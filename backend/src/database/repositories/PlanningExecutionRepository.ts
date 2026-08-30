import type { PlannedContentItem, PlanningExecutionEvent, Prisma, PrismaClient } from '@prisma/client';
import type { PlanningExecutionState } from '../../domains/strategic-planning';

export class PlanningExecutionTransitionConflict extends Error {
  constructor(message = 'planning execution transition is not allowed') {
    super(message); this.name = 'PlanningExecutionTransitionConflict';
  }
}

export interface TransitionPlanningExecutionData {
  itemId: string;
  state: PlanningExecutionState;
  event: string;
  action: string;
  reason: string | null;
  confidence: number | null;
  strategicContext: Prisma.InputJsonValue;
  occurredAt: Date;
}

const allowedTransitions: Record<PlanningExecutionState, readonly PlanningExecutionState[]> = {
  pending: ['in_progress', 'completed', 'skipped', 'paused'],
  in_progress: ['completed', 'skipped', 'paused'],
  paused: ['pending', 'in_progress', 'completed', 'skipped'],
  completed: [],
  skipped: [],
};

const statusFor = (state: PlanningExecutionState): string => ({
  pending: 'READY', in_progress: 'IN_PROGRESS', completed: 'COMPLETED', skipped: 'CANCELLED', paused: 'PAUSED',
})[state];

export class PlanningExecutionRepository {
  constructor(private readonly client: PrismaClient) {}

  async transition(data: TransitionPlanningExecutionData): Promise<{
    item: PlannedContentItem;
    event: PlanningExecutionEvent | null;
    changed: boolean;
  }> {
    return this.client.$transaction(async (transaction) => {
      const before = await transaction.plannedContentItem.findUniqueOrThrow({ where: { id: data.itemId } });
      const current = before.executionState as PlanningExecutionState;
      if (current === data.state) return { item: before, event: null, changed: false };
      if (!allowedTransitions[current]?.includes(data.state)) throw new PlanningExecutionTransitionConflict();

      await transaction.plannedContentItem.update({
        where: { id: before.id },
        data: {
          executionState: data.state,
          status: statusFor(data.state),
          executionStartedAt: data.state === 'in_progress' ? before.executionStartedAt ?? data.occurredAt : before.executionStartedAt,
          executionEndedAt: ['completed', 'skipped'].includes(data.state) ? data.occurredAt : null,
          completedAt: data.state === 'completed' ? data.occurredAt : data.state === 'skipped' ? null : before.completedAt,
        },
      });

      const ordered = await transaction.plannedContentItem.findMany({
        where: { planId: before.planId }, orderBy: [{ position: 'asc' }, { id: 'asc' }],
      });
      const running = ordered.find(({ executionState }) => executionState === 'in_progress');
      const eligible = ordered.filter((item) => !['completed', 'skipped', 'paused'].includes(item.executionState)
        && !['COMPLETED', 'CANCELLED', 'PAUSED'].includes(item.status)
        && item.readiness === 'READY');
      const nextId = running?.id ?? eligible[0]?.id ?? null;
      for (const item of ordered) {
        const queue = ['completed', 'skipped'].includes(item.executionState) || ['COMPLETED', 'CANCELLED'].includes(item.status) ? 'DONE'
          : item.executionState === 'paused' || item.status === 'PAUSED' || item.readiness === 'NEEDS_RESEARCH' ? 'WAITING'
            : item.readiness === 'BLOCKED' || item.status === 'BLOCKED' ? 'BLOCKED'
              : item.id === nextId ? 'NEXT' : 'LATER';
        if (item.queue !== queue) await transaction.plannedContentItem.update({ where: { id: item.id }, data: { queue } });
      }

      const item = await transaction.plannedContentItem.findUniqueOrThrow({ where: { id: before.id } });
      const event = await transaction.planningExecutionEvent.create({
        data: {
          planId: before.planId, itemId: before.id, event: data.event, state: data.state,
          itemTitle: before.title, action: data.action, reason: data.reason,
          confidence: data.confidence, strategicContext: data.strategicContext, createdAt: data.occurredAt,
        },
      });
      await transaction.planningHistory.create({
        data: {
          planId: before.planId, itemId: before.id, event: data.event, reason: data.reason ?? data.action,
          before: before as unknown as Prisma.InputJsonValue,
          after: item as unknown as Prisma.InputJsonValue,
          createdAt: data.occurredAt,
        },
      });
      return { item, event, changed: true };
    });
  }

  async findAll(filters: { planId?: string; itemId?: string; limit?: number } = {}): Promise<PlanningExecutionEvent[]> {
    return this.client.planningExecutionEvent.findMany({
      where: {
        ...(filters.planId ? { planId: filters.planId } : {}),
        ...(filters.itemId ? { itemId: filters.itemId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: filters.limit ?? 100,
    });
  }
}
