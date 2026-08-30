import type { EditorialDecision, PrismaClient } from '@prisma/client';
import { EditorialDecisionRepository } from './EditorialDecisionRepository';

export interface DecisionHistoryFilters {
  projectId?: string | null;
  conversationId?: string | null;
  limit?: number;
}

export class DecisionHistoryRepository extends EditorialDecisionRepository {
  constructor(client: PrismaClient) {
    super(client);
  }

  async findCurrent(filters: Omit<DecisionHistoryFilters, 'limit'> = {}): Promise<EditorialDecision | null> {
    return (await this.findAll({ ...filters, limit: 1 }))[0] ?? null;
  }

  async findOpportunities(filters: DecisionHistoryFilters = {}): Promise<EditorialDecision[]> {
    return this.findAll({
      ...filters,
      categories: ['PRIORITIZE', 'CONTINUE', 'TEST'],
      limit: filters.limit ?? 20,
    });
  }

  async findRisks(filters: DecisionHistoryFilters = {}): Promise<EditorialDecision[]> {
    const rows = await this.findAll({ ...filters, limit: Math.min(50, filters.limit ?? 20) });
    return rows.filter((decision) => {
      const risks = Array.isArray(decision.risks) ? decision.risks : [];
      return risks.length > 0 || ['PAUSE', 'REEVALUATE', 'INSUFFICIENT_DATA'].includes(decision.category);
    });
  }
}
